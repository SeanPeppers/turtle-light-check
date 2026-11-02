// Fake data so the map can be demoed before the backend exists.
export const SAMPLE_FINDINGS = [
  { id: "s1", lat: 26.4532, lng: -81.9570, status: "possible_issue", type: "balcony", color: "white", fix: "Add a shield so the bulb isn't visible", source: "photo" },
  { id: "s2", lat: 26.4470, lng: -81.9495, status: "possible_issue", type: "pool", color: "blue", fix: "Turn off pool lights after dark", source: "photo" },
  { id: "s3", lat: 26.4415, lng: -81.9420, status: "ok", type: "porch", color: "amber", fix: "Looks compliant", source: "photo" },
  { id: "s4", lat: 26.4360, lng: -81.9350, status: "possible_issue", type: "parking", color: "white", fix: "Lower the fixture and aim it down", source: "drone", frameTime: 4 },
  { id: "s5", lat: 26.4300, lng: -81.9270, status: "ok", type: "window", color: "other", fix: "Looks compliant", source: "drone", frameTime: 7 },
];
