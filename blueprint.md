Hackathon Project Blueprint: Centralized Community Triage (doable beginner ai assisted in 24 hours. but still kinda ambitious. dont want it to be too easy. want a chance to place well)
1. Product Vision & Problem Statement
The Problem: Citizens suffer from "reporting fatigue" because they don't know which agency or nonprofit handles which issue (e.g., 311 vs. Parks Dept vs. local food bank). Meanwhile, organizations receive messy, incomplete reports and spend hours manually triaging them. The Solution: A single, unified interface where users describe what they see in natural language. An AI layer structures the data, asks clarifying questions if needed, and routes the ticket to the correct entity, providing organizations with a clean, actionable dashboard.
2. User Personas
The Reporter (Community Member): Wants to solve a problem in their neighborhood quickly. Doesn't know (or care) about municipal jurisdictions. Wants low friction (no mandatory account creation to submit a tip).
The Resolver (Nonprofit / City Agency): Understaffed and overwhelmed. Needs reports to be pre-sorted by severity, categorized accurately, and formatted uniformly (location, photos, specific needs).
3. Core Functionality (MVP Scope for the Hackathon)
To finish over the weekend, restrict your build to these essential features:
A. The Citizen Experience (Frontend)
Single Text Input: A simple UI (web or SMS) where users simply type what is happening ("There is a massive pothole on 5th and Main" or "Tree fell on a power line").
Dynamic Clarification (AI Loop): If the initial report lacks key data, the system replies automatically (e.g., "Could you provide the closest cross street?" or "Are there any active sparks?").
Emergency Intercept: Hardcoded logic to detect life-threatening keywords (fire, gun, unresponsive). Immediately halts the standard flow and displays/prompts a 911 call button.
B. The AI Triage Engine (Backend)
Intent Classification: LLM categorizes the raw text into predefined buckets (Infrastructure, Public Safety, Environmental, Human Services).
Entity Extraction: Pulls out standard data points (Location, Hazard Type, Number of People involved) and formats them into a JSON object.
Severity Scoring: Assigns a Priority Level (Low, Medium, High, Critical) based on the extracted context.
C. The Resolver Dashboard (Nonprofit/Agency View)
Triage Board: A Kanban-style board or a simple list view showing new, structured tickets.
Map View: Pins on a map generated from the extracted locations to easily spot geographic clusters.
Analytics Summary: A top-level widget showing "Active High-Priority Issues" and "Reports by Category."
4. User Flow (The "Happy Path")
Input: User opens the web app and types: "Found a stray dog looking aggressive near the elementary school on Elm St."
Processing: The backend LLM parses the text.
Clarification: The system responds: "Thanks. To help Animal Control, is the dog contained or actively running loose?"
Enrichment: User replies "Running loose." The LLM updates the JSON payload to priority: HIGH, category: ANIMAL_CONTROL.
Routing: The payload is pushed to the local Animal Rescue / Animal Control dashboard.
Resolution: The agency logs in, sees a red "HIGH PRIORITY" pin on their map, and dispatches a team.
5. Out of Scope (Do Not Build This Weekend)
User authentication for reporters (allow anonymous or simple phone number validation).
Complex multi-agency jurisdictional routing (mock the routing with 3-4 predefined "buckets").
Native iOS/Android apps (stick to a responsive web app or SMS via Twilio).

