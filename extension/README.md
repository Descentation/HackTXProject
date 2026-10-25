# Light Coach browser extension

When any website asks for your camera (Google Meet, Teams on the web, Zoom's web client, etc.), Light Coach asks:
"Use Light Coach?" If you say yes, it lights your face with a virtual light before the site gets your video,
and shows a small floating panel with your score ("your camera -> with light") and a lighting tip.

- Works in Chrome and Edge, on websites. It does not work inside the desktop Zoom/Teams apps (those would need a virtual camera).
- Assumes your face is near the center of the frame (no face tracking in the extension yet).
- Everything runs on your computer. No video is uploaded.

## Install (1 minute)
1. Open chrome://extensions (or edge://extensions).
2. Turn on Developer mode (top right).
3. Click "Load unpacked" and pick this folder (the one with manifest.json).
4. Open a site that uses your camera (e.g. meet.google.com, or webcamtests.com) and allow the camera.
