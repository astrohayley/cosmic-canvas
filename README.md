# Cosmic Canvas — Zooniverse Brush Tool Classifier

An interactive drawing classifier based on the [Zooniverse IFE Classifier Template](https://github.com/kieftrav/Zooniverse-IFE-April-2026-Workshop). This specialized version includes a brush tool for annotation tasks requiring freehand drawing.

## Attribution

This project is forked from the excellent Zooniverse IFE Classifier Template by [@kieftrav](https://github.com/kieftrav). Original repository: https://github.com/kieftrav/Zooniverse-IFE-April-2026-Workshop

## Quick Start

```bash
git clone https://github.com/astrohayley/cosmic-canvas.git
cd cosmic-canvas
npm install
```

### Configure your project

Copy the example config to a new file:

```bash
cp src/config.example.js src/config.js
```

Edit `src/config.js` — set your Zooniverse project ID and (optionally) workflow ID:

```js
const config = {
  projectId: '31425',
  workflowId: null,       // null = use project's default active workflow
  environment: 'production',
};
```

### Authentication (optional)

Copy `.env.example` to `.env` and add your Zooniverse credentials:

```bash
cp .env.example .env
```

```
VITE_PANOPTES_USERNAME=your_username
VITE_PANOPTES_PASSWORD=your_password
```

The app will sign in automatically on startup. Without a `.env`, it runs in anonymous mode. The header shows your auth status.

### Run

```bash
npm start
```

Open http://localhost:3002.

You can also override config via URL params:

```
http://localhost:3002/?project=31425
http://localhost:3002/?project=31425&workflow=30447
```

## Classifying

Load the app, view the subject, and click **Done** to submit a classification to the Panoptes API. Click **Skip** to move to the next subject without submitting.

## Exporting Data

The export bar at the bottom of the page has buttons for **project**, **workflow**, **subject-sets**, and **subjects**. Click any of them to download the JSON from the Panoptes API into the `exports/` folder in this repo. Open that folder to inspect the raw data.

This only works during local development (the Vite dev server writes files to disk).


## Project Structure

```
src/
  config.js               # Your project/workflow IDs, environment, links
  App.js                  # The classify loop (load → annotate → submit → next)
  components/
    SubjectViewer.js      # Displays subject images
    TaskUI.js             # Renders workflow tasks as forms
  services/
    panoptesService.js    # Panoptes API client
  index.css               # Styles
.env.example              # Template for credentials
vite.config.js            # Dev server, auth proxy, export-to-disk middleware
exports/                  # Exported JSON (gitignored)
```

## Commands

| Command | Description |
|---|---|
| `npm start` | Dev server on http://localhost:3002 |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview production build |
| `npm run lint` | Check code style |

## Links

- [Zooniverse](https://www.zooniverse.org/)
- [Panoptes API docs](https://zooniverse.github.io/panoptes-javascript-client/)
- [Data Exports](https://www.zooniverse.org/lab/31425/data-exports) — view and export classification data from the Zooniverse Lab
