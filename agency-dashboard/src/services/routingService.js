import { routeReport } from "../data/routing";

const categoryRules = {
  Infrastructure: ["pothole", "streetlight", "road", "sidewalk", "traffic signal", "flooding"],
  "Public Safety": ["vandalism", "abandoned car", "weapon", "sparks", "power line", "danger"],
  Environmental: ["dumping", "graffiti", "trash", "chemical", "leaking", "pollution"],
  "Human Services": ["food", "shelter", "homeless", "families", "water", "supplies"],
  "Animal Control": ["stray dog", "loose dog", "animal", "bitten", "cruelty", "lost pet"],
};

const dangerWeights = {
  "life threatening": 45, fire: 45, gun: 45, weapon: 40, unresponsive: 45,
  sparks: 35, "power line": 35, leaking: 20, traffic: 18, school: 18,
  blocked: 15, aggressive: 18, flooding: 18,
};

function normalize(text = "") {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter((word) => word.length > 2 && !["the", "and", "near", "with", "from", "this"].includes(word));
}

function textSimilarity(a, b) {
  const first = new Set(normalize(a));
  const second = new Set(normalize(b));
  const intersection = [...first].filter((word) => second.has(word)).length;
  const union = new Set([...first, ...second]).size;
  return union ? intersection / union : 0;
}

function distanceMiles(a, b) {
  if (!a?.lat || !b?.lat) return 99;
  const toRad = (degrees) => degrees * Math.PI / 180;
  const earthRadius = 3959;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function classifyReport(text) {
  const content = text.toLowerCase();
  const scores = Object.entries(categoryRules).map(([category, words]) => ({
    category,
    score: words.reduce((total, word) => total + (content.includes(word) ? 1 : 0), 0),
  })).sort((a, b) => b.score - a.score);
  const winner = scores[0];
  return { category: winner.score ? winner.category : "Infrastructure", confidence: Math.min(98, 68 + winner.score * 9) };
}

export function findDuplicates(incoming, existingReports) {
  return existingReports.map((report) => {
    const similarity = textSimilarity(`${incoming.title} ${incoming.description}`, `${report.title} ${report.description}`);
    const miles = distanceMiles(incoming.locationData, report.locationData);
    const hours = Math.abs(new Date(incoming.submittedAt) - new Date(report.submittedAt)) / 36e5;
    const sameCategory = incoming.category === report.category;
    const matchScore = similarity * 55 + (miles <= 0.5 ? 25 : miles <= 2 ? 12 : 0) + (hours <= 6 ? 12 : hours <= 24 ? 5 : 0) + (sameCategory ? 8 : 0);
    return { report, matchScore: Math.round(matchScore), miles: Number(miles.toFixed(1)) };
  }).filter((match) => match.matchScore >= 42).sort((a, b) => b.matchScore - a.matchScore);
}

export function calculatePriority(report, duplicateCount) {
  const content = `${report.title} ${report.description}`.toLowerCase();
  const dangerScore = Object.entries(dangerWeights).reduce((score, [word, weight]) => score + (content.includes(word) ? weight : 0), 0);
  const duplicateScore = Math.min(25, duplicateCount * 7);
  const sensitiveLocationScore = /(school|hospital|freeway|intersection)/.test(content) ? 15 : 0;
  const total = Math.min(100, dangerScore + duplicateScore + sensitiveLocationScore + 10);
  return { priority: total >= 70 ? "Critical" : total >= 42 ? "High" : total >= 22 ? "Medium" : "Low", score: total };
}

export function analyzeReport(rawReport, existingReports) {
  const classification = classifyReport(`${rawReport.title} ${rawReport.description}`);
  const categorized = { ...rawReport, category: classification.category };
  const duplicates = findDuplicates(categorized, existingReports);
  const priority = calculatePriority(categorized, duplicates.length);
  const verification = Math.min(98, 70 + duplicates.length * 7 + (rawReport.source === "Partner" ? 10 : 0));
  return {
    ...categorized,
    priority: priority.priority,
    priorityScore: priority.score,
    confidence: classification.confidence,
    verification,
    reports: duplicates.length + 1,
    duplicateMatches: duplicates.map(({ report, matchScore, miles }) => ({ id: report.id, matchScore, miles })),
    routedOrganization: routeReport(classification.category).name,
  };
}
