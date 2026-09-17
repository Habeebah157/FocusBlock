# FocusBlock

A React-powered browser extension for blocking distracting websites for a
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
5. Click the FocusBlock toolbar icon, enter a domain, and choose a duration.

The extension uses Manifest V3 dynamic rules, so blocked navigation is
stopped by the browser and rules are removed when their timer expires.
