# NexSpeak Desktop

Placeholder for the Electron app (milestone "Beta 0.2 – Desktop").

The desktop app reuses the web app completely: it packages the static build of `apps/web` and
only adds the Electron main process, a preload bridge (push-to-talk, tray, screen source picker)
and the packaging configuration. See `docs/beta-plan.md`.
