// Map GRINT code (character or number) -> category and color label used by the UI.
// Sourced from Tampere GRINT/DINT technical report. (We group states into Green/Amber/Red/Unknown.)
// Ref: ITS Factory wiki + GRINT states PDF.
const GRINT = {
  toCategory(code) {
    // Normalize
    if (code === null || code === undefined) return "unknown";
    const c = String(code).trim();
    // Greens
    const greenSet = new Set(["1","3","4","5","6","7","8","10"]); // 10 = green blinking for pedestrian; treat as active/greenish
    // Ambers
    const amberSet = new Set(["10","11","12","14","25"]); // include fixed amber, blinking, vehicle actuated amber, startup amber
    // Reds
    // 0 (red/amber), 9 (red sync), 13 (amber/dark malfunction), 15–26 multiple red variants
    const isRedRange = (x) => {
      const n = Number.parseInt(x, 36); // handles 0-9, A=10, B=11...
      // Map 'A'..'Z' too; but we’ll just handle typical 0..26 set
      return ["0","9","13","15","16","17","18","19","20","21","22","23","24","26"].includes(x) ||
             (Number.isFinite(Number(x)) && Number(x) >= 15 && Number(x) <= 26);
    };

    if (greenSet.has(c)) return "green";
    if (amberSet.has(c)) return "amber";
    if (isRedRange(c)) return "red";
    return "unknown";
  },
  color(cat) {
    switch (cat) {
      case "green": return "#29a745";
      case "amber": return "#ffc107";
      case "red":   return "#dc3545";
      default:      return "#6c757d";
    }
  }
};

window.GRINT = GRINT;
