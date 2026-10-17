export const organizations = {
  Infrastructure: { name:"MyLA311 + StreetsLA", short:"311", phone:"311 or (213) 473-3231", url:"https://lacity.gov/myla311", coverage:"City of Los Angeles", services:"Potholes, streetlights, sidewalks, street repair", color:"#4b7390" },
  "Public Safety": { name:"LAPD Non-Emergency", short:"LAPD", phone:"1-877-ASK-LAPD", url:"https://www.lapdonline.org/file-a-police-report/", coverage:"City of Los Angeles", services:"Vandalism, abandoned vehicles, non-emergency safety", color:"#b64f42" },
  Environmental: { name:"LA Sanitation & Environment", short:"LASAN", phone:"1-800-773-2489", url:"https://sanitation.lacity.gov/", coverage:"City of Los Angeles", services:"Illegal dumping, waste, sanitation, environmental hazards", color:"#498264" },
  "Human Services": { name:"211 LA + LA County DPSS", short:"211 LA", phone:"Dial 2-1-1 · DPSS (866) 613-3777", url:"https://211la.org/", coverage:"Los Angeles County", services:"Food, shelter, benefits, crisis-resource navigation", color:"#8a6c3e" },
  "Animal Control": { name:"LA Animal Services", short:"LAAS", phone:"(888) 452-7381", url:"https://www.laanimalservices.com/", coverage:"City of Los Angeles", services:"Loose or dangerous animals, cruelty, lost pets", color:"#77639a" },
};

export function routeReport(category) {
  return organizations[category] || organizations.Infrastructure;
}
