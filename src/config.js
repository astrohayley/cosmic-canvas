/**
 * Zoo Playground Configuration
 *
 * Fork this repo, change these values to your Zooniverse project,
 * and you have a working custom classifier.
 */
const config = {
  // Your Zooniverse project ID (find it in the Project Builder URL or API)
  projectId: '32203',

  // Your workflow ID (find it in the Project Builder under Workflows)
  workflowId: '31480', // null = use the project's default active workflow

  // Environment: 'production' or 'staging'
  environment: 'production',

  // Number of subjects to fetch at a time
  subjectBatchSize: 10,

  // Project metadata (displayed in the UI)
  title: 'Cosmic Canvas',

  // Data rights / privacy / Terms & Conditions
  links: {
    privacyPolicy: 'https://www.zooniverse.org/privacy',
    termsOfUse: 'https://www.zooniverse.org/privacy#terms',
    dataRetention: null, // Add your project-specific data retention URL
    talkBoard: null,     // Auto-populated from project ID if null
  }
};

export default config;
