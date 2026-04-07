import { useState, useEffect, useCallback } from 'react';
import panoptesService from './services/panoptesService';
import BrushTool from './components/BrushTool.jsx';
import config from './configLoader';

// Resolve settings once: URL params override config
const params = new URLSearchParams(window.location.search);
const settings = {
  projectId: params.get('project') || config.projectId,
  workflowId: params.get('workflow') || config.workflowId,
  environment: params.get('env') || config.environment,
};

function App() {
  const [project, setProject] = useState(null);
  const [workflow, setWorkflow] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [subjectIndex, setSubjectIndex] = useState(0);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [brushAnnotationData, setBrushAnnotationData] = useState(null);
  const [maskSeedInfo, setMaskSeedInfo] = useState(null);
  const [classificationStartedAt, setClassificationStartedAt] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submissionResult, setSubmissionResult] = useState(null);
  const [classified, setClassified] = useState(0);
  const [activeTab, setActiveTab] = useState('classify');
  const [authUser, setAuthUser] = useState(null);
  const [exporting, setExporting] = useState({});

  const currentSubject = subjects[subjectIndex] || null;
  const talkUrl = config.links.talkBoard ||
    (project ? `https://www.zooniverse.org/projects/${project.slug}/talk` : null);

  useEffect(() => {
    if (!settings.projectId) {
      setLoading(false);
      setError('No project ID. Add ?project=YOUR_PROJECT_ID to the URL, or set it in src/config.js');
      return;
    }
    initialize();
  }, []);

  const initialize = async () => {
    setLoading(true);
    setError(null);

    try {
      const username = import.meta.env.VITE_PANOPTES_USERNAME;
      const password = import.meta.env.VITE_PANOPTES_PASSWORD;
      if (username && password && !panoptesService.isAuthenticated()) {
        try {
          const { user } = await panoptesService.signIn(username, password, settings.environment);
          setAuthUser(user?.login || username);
        } catch (authErr) {
          console.warn('Auto-auth failed, continuing as anonymous:', authErr.message);
        }
      }

      const projectData = await panoptesService.getProject(settings.projectId, settings.environment);
      setProject(projectData);

      const workflowData = settings.workflowId
        ? await panoptesService.getWorkflow(settings.workflowId, settings.environment)
        : await panoptesService.getActiveWorkflow(settings.projectId, settings.environment);
      setWorkflow(workflowData);

      const subjectData = await panoptesService.getSubjects(
        workflowData.id, settings.environment, config.subjectBatchSize
      );
      setSubjects(subjectData);
      setClassificationStartedAt(new Date().toISOString());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const advanceSubject = useCallback(() => {
    setSubjectIndex(prev => prev < subjects.length - 1 ? prev + 1 : 0);
    setSelectedImageIndex(0);
    setBrushAnnotationData(null);
    setMaskSeedInfo(null);
    setSubmissionResult(null);
    setClassificationStartedAt(new Date().toISOString());
  }, [subjects.length]);

  const handleSubmit = async () => {
    if (!currentSubject || !workflow) return;

    setSubmitting(true);
    setSubmissionResult(null);

    try {
      const result = await panoptesService.createClassification({
        annotations: [{ task: 'T0', value: brushAnnotationData || 'No annotation' }],
        metadata: {
          workflow_version: workflow.version || '1.0',
          started_at: classificationStartedAt,
          finished_at: new Date().toISOString(),
          user_agent: navigator.userAgent,
          user_language: navigator.language,
          utc_offset: String(new Date().getTimezoneOffset() * 60),
          source: 'zoo-playground',
          machine_mask: maskSeedInfo,
          viewport: { width: window.innerWidth, height: window.innerHeight }
        },
        links: {
          project: project.id,
          workflow: workflow.id,
          subjects: [currentSubject.id]
        },
        completed: true
      }, settings.environment);

      setSubmissionResult({ success: true, data: result });
      setClassified(prev => prev + 1);
      setTimeout(() => advanceSubject(), 800);
    } catch (err) {
      setSubmissionResult({ success: false, error: err.response?.data?.errors?.[0]?.message || err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleExport = async (type) => {
    setExporting(prev => ({ ...prev, [type]: true }));
    try {
      const fetchers = {
        project:        () => panoptesService.getProject(project.id, settings.environment),
        workflow:       () => panoptesService.getWorkflow(workflow.id, settings.environment),
        'subject-sets': () => panoptesService.getSubjectSets(workflow.id, settings.environment),
        subjects:       () => panoptesService.getSubjects(workflow.id, settings.environment, config.subjectBatchSize),
      };
      const ids = { project: project.id, workflow: workflow.id, 'subject-sets': workflow.id, subjects: workflow.id };
      const data = await fetchers[type]();
      await fetch('/__export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: `${type}-${ids[type]}.json`, data })
      });
    } catch (err) {
      console.error(`Export ${type} failed:`, err.message);
    } finally {
      setExporting(prev => ({ ...prev, [type]: false }));
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <h1 style={{ fontSize: '18px', margin: 0 }}>
            {project?.display_name || config.title}
          </h1>
          <span className="text-muted" style={{ fontSize: '12px' }}>
            {settings.environment} · {classified} classified · {authUser ? `signed in as ${authUser}` : 'anonymous'}
          </span>
        </div>
        <nav className="header-nav">
          <button
            onClick={() => setActiveTab('classify')}
            className={`tab-button ${activeTab === 'classify' ? 'active' : ''}`}
          >
            Classify
          </button>
          {project && (
            <button
              onClick={() => setActiveTab('project')}
              className={`tab-button ${activeTab === 'project' ? 'active' : ''}`}
            >
              About
            </button>
          )}
          {talkUrl && (
            <a href={talkUrl} target="_blank" rel="noopener noreferrer" className="tab-button">
              Talk
            </a>
          )}
        </nav>
      </header>

      <main className="app-main">
        {loading && (
          <div className="center-state">
            <p>Loading project from {settings.environment}...</p>
          </div>
        )}

        {error && !loading && (
          <div className="center-state">
            <h2>Something went wrong</h2>
            <p className="text-error">{error}</p>
            <p className="text-muted" style={{ fontSize: '14px' }}>
              Try: ?project=32203 or ?project=31425
            </p>
          </div>
        )}

        {!loading && !error && activeTab === 'classify' && (
          <div className="classify-layout">
            <div className="classify-subject">
              <BrushTool
                subject={currentSubject}
                selectedImageIndex={selectedImageIndex}
                onImageSelect={setSelectedImageIndex}
                onAnnotate={setBrushAnnotationData}
                onMaskInfo={setMaskSeedInfo}
                brushConfig={config.brushTool}
              />
              {subjects.length > 0 && (
                <div className="subject-progress">
                  <span className="text-muted" style={{ fontSize: '12px' }}>
                    {subjectIndex + 1} / {subjects.length}
                  </span>
                </div>
              )}
            </div>

            <div className="classify-task">
              <div className="classify-actions">
                <button onClick={handleSubmit} disabled={submitting} className="submit-button">
                  {submitting ? 'Submitting...' : 'Done'}
                </button>
                <button onClick={advanceSubject} disabled={submitting} className="skip-button">
                  Skip
                </button>
              </div>

              {submissionResult && (
                <div className={`mt-sm p-sm rounded-sm ${submissionResult.success ? 'success' : 'error'}`}>
                  <span className={submissionResult.success ? 'success-text' : 'error-text'}
                        style={{ fontSize: '13px' }}>
                    {submissionResult.success
                      ? 'Classification submitted!'
                      : `Error: ${submissionResult.error}`}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {!loading && !error && activeTab === 'project' && project && (
          <div className="about-page">
            <h2>{project.display_name}</h2>
            {project.description && <p style={{ fontSize: '14px' }}>{project.description}</p>}
            {project.introduction && <div style={{ fontSize: '14px' }}>{project.introduction}</div>}
            <div className="about-links">
              <a href={`https://www.zooniverse.org/projects/${project.slug}`}
                 target="_blank" rel="noopener noreferrer">View on Zooniverse</a>
              {config.links.privacyPolicy && (
                <a href={config.links.privacyPolicy} target="_blank" rel="noopener noreferrer">Privacy Policy</a>
              )}
              {config.links.termsOfUse && (
                <a href={config.links.termsOfUse} target="_blank" rel="noopener noreferrer">Terms of Use</a>
              )}
            </div>
          </div>
        )}
      </main>

      {!loading && !error && project && workflow && (
        <div className="export-bar">
          <span className="text-muted" style={{ fontSize: '12px' }}>Export to ./exports/</span>
          <div className="export-buttons">
            {['project', 'workflow', 'subject-sets', 'subjects'].map(type => (
              <button key={type} onClick={() => handleExport(type)} disabled={exporting[type]} className="export-button">
                {exporting[type] ? '...' : type}
              </button>
            ))}
          </div>
        </div>
      )}

      <footer className="app-footer">
        <span className="text-muted" style={{ fontSize: '11px' }}>
          Powered by Zooniverse · Panoptes API · zoo-playground
        </span>
      </footer>
    </div>
  );
}

export default App;
