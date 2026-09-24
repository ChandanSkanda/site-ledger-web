// A single active project for this session. The app only ever shows one
// project at a time, so rather than threading a projectId prop through
// every component, storage.js and audit.js read it from here — set once,
// right after login/project-selection, in AuthGate.jsx.
let activeProjectId = null;
let activeProjectMeta = null; // { name, place, type }

export function setActiveProject(id, meta) {
  activeProjectId = id;
  activeProjectMeta = meta || null;
}
export function getActiveProjectId() {
  return activeProjectId;
}
export function getActiveProjectMeta() {
  return activeProjectMeta;
}
