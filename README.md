# FocusBlock

A React-powered browser extension for creating focused website allowlists for a
chosen amount of time.

## Run as a web app

```bash
npm install
npm run dev
```

The web preview stores rules in `localStorage`. The **Web version** button in
the extension opens the same dashboard in a full browser tab.

## Load the extension

1. Run `npm run build`.
2. Open `chrome://extensions` (or the equivalent extensions page).
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the generated `dist` folder.
5. Click the FocusBlock toolbar icon, create or choose a focus folder, add the
	websites you want available, choose a duration, and press **Start blocking**.

The active folder is an allowlist: when blocking is started, websites in it
remain available and every other website is redirected to the focus screen.
Allowed entries are removed when their timers expire. Press **Stop blocking**
to pause the blocker without losing your folders or allowed sites.
