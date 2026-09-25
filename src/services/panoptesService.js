import axios from 'axios';

const API_URLS = {
  production: 'https://panoptes.zooniverse.org/api',
  staging: 'https://panoptes-staging.zooniverse.org/api'
};

const headers = {
  'Accept': 'application/vnd.api+json; version=1',
  'Content-Type': 'application/json'
};

let bearerToken = null;
let tokenExpiry = 0;

const panoptesService = {
  async getProject(projectId, environment = 'production') {
    const apiUrl = API_URLS[environment] || API_URLS.production;
    const response = await axios.get(`${apiUrl}/projects/${projectId}`, { headers });
    return response.data.projects[0];
  },

  async getWorkflow(workflowId, environment = 'production') {
    const apiUrl = API_URLS[environment] || API_URLS.production;
    const response = await axios.get(`${apiUrl}/workflows/${workflowId}`, { headers });
    return response.data.workflows[0];
  },

  async getActiveWorkflow(projectId, environment = 'production') {
    const project = await this.getProject(projectId, environment);
    const activeWorkflows = project.links?.active_workflows || [];
    if (activeWorkflows.length === 0) {
      throw new Error(`Project ${projectId} has no active workflows`);
    }
    return this.getWorkflow(activeWorkflows[0], environment);
  },

  async getSubjectSets(workflowId, environment = 'production') {
    const apiUrl = API_URLS[environment] || API_URLS.production;
    const workflow = await this.getWorkflow(workflowId, environment);
    const subjectSetIds = workflow.links?.subject_sets || [];
    if (subjectSetIds.length === 0) return [];
    const response = await axios.get(`${apiUrl}/subject_sets`, {
      headers,
      params: { id: subjectSetIds.join(',') }
    });
    return response.data.subject_sets || [];
  },

  async getSubjects(workflowId, environment = 'production', pageSize = 10, projectId = null) {
    const apiUrl = API_URLS[environment] || API_URLS.production;
    let queuedSubjects = [];

    // Try the queued endpoint first (what FEM's classifier uses)
    try {
      const response = await axios.get(`${apiUrl}/subjects/queued`, {
        headers: this.getAuthHeaders(),
        params: { workflow_id: workflowId, page_size: pageSize, http_cache: true }
      });
      if (response.data.subjects?.length > 0) {
        queuedSubjects = response.data.subjects;
        if (queuedSubjects.some(subject => typeof subject.metadata?.['#mask_rle'] === 'string')) {
          return queuedSubjects;
        }
      }
    } catch (e) {
      // queued endpoint may require auth; fall back
    }

    // Mask seeds now live in subject metadata. During subject-set migrations the
    // workflow queue can temporarily continue serving the previous, mask-less
    // set, so prefer a project-linked set that contains the new metadata field.
    if (projectId) {
      const project = await this.getProject(projectId, environment);
      const projectSubjectSetIds = project.links?.subject_sets || [];
      for (const subjectSetId of [...projectSubjectSetIds].reverse()) {
        const response = await axios.get(`${apiUrl}/subjects`, {
          headers,
          params: { subject_set_id: subjectSetId, page_size: pageSize, http_cache: true }
        });
        const subjects = response.data.subjects || [];
        if (subjects.some(subject => typeof subject.metadata?.['#mask_rle'] === 'string')) {
          return subjects;
        }
      }
    }

    if (queuedSubjects.length > 0) return queuedSubjects;

    // Fallback: subjects via workflow's linked subject sets
    const workflow = await this.getWorkflow(workflowId, environment);
    const subjectSetIds = workflow.links?.subject_sets || [];
    if (subjectSetIds.length === 0) {
      throw new Error(`Workflow ${workflowId} has no linked subject sets`);
    }
    const response = await axios.get(`${apiUrl}/subjects`, {
      headers,
      params: { subject_set_id: subjectSetIds[0], page_size: pageSize, http_cache: true }
    });
    return response.data.subjects || [];
  },

  // Browser auth uses the Vite proxy at /zooniverse/ to avoid CORS.
  // The proxy rewrites to https://www.zooniverse.org (production) or
  // https://panoptes-staging.zooniverse.org (staging).
  async signIn(login, password, environment = 'production') {
    const proxy = '/zooniverse';

    const authHeaders = { 'Accept': 'application/json', 'Content-Type': 'application/json' };

    const csrfResponse = await axios.get(
      `${proxy}/users/sign_in/?now=${Date.now()}`,
      { headers: authHeaders, withCredentials: true }
    );
    const csrfToken = csrfResponse.headers['x-csrf-token'];

    const signInResponse = await axios.post(
      `${proxy}/users/sign_in`,
      { user: { login, password, remember_me: true } },
      { headers: { ...authHeaders, 'X-CSRF-Token': csrfToken }, withCredentials: true }
    );

    const tokenResponse = await axios.post(
      `${proxy}/oauth/token`,
      { grant_type: 'password', client_id: 'f79cf5ea821bb161d8cbb52d061ab9a2321d7cb169007003af66b43f7b79ce2a' },
      { headers: authHeaders, withCredentials: true }
    );

    bearerToken = tokenResponse.data.access_token;
    tokenExpiry = Date.now() + (tokenResponse.data.expires_in * 1000) - 60000;
    return { user: signInResponse.data, token: bearerToken };
  },

  isAuthenticated() {
    return bearerToken && Date.now() < tokenExpiry;
  },

  getAuthHeaders() {
    if (!this.isAuthenticated()) return headers;
    return { ...headers, Authorization: `Bearer ${bearerToken}` };
  },

  async createClassification(classificationData, environment = 'production') {
    const apiUrl = API_URLS[environment] || API_URLS.production;
    const response = await axios.post(
      `${apiUrl}/classifications`,
      { classifications: classificationData },
      { headers: this.getAuthHeaders() }
    );
    return response.data;
  },

  signOut() {
    bearerToken = null;
    tokenExpiry = 0;
  }
};

export default panoptesService;
