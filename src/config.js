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
  },

  // Brush tool configuration
  brushTool: {
    colors: ['#00bfff'], // '#00ff00', '#ff0000', '#00bfff', '#ffff00', '#ff00ff', '#ffffff'],
    opacity: 0.3,
    defaultSize: 12,
    machineMask: {
      enabled: true,
      // Brightness threshold 0-255 used for fallback machine seed generation.
      threshold: 128,
      // Set true when targets are darker-than-background.
      invert: false,
      // Sampling controls for performance/fidelity tradeoff.
      rowStep: 2,
      colStep: 2,
      minRunLength: 2,
      maxLines: 8000,
      // Visual settings for the seeded mask overlay.
      // Color is taken from the active drawing color.
      opacity: 0.28,
      brushRadius: 1,
      canvasWidth: 500,
      canvasHeight: 500
    }
  }
};

export default config;
