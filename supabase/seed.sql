-- Demo data: 5 agencies + 16 tickets around USC. Run after schema.sql.
-- Re-runnable: wipes existing rows first. Timestamps are relative to now(),
-- so re-run it right before the demo to make everything look fresh.
-- Phone numbers use the fictional 555-01xx range.

truncate messages, tickets, conversations, agencies restart identity cascade;

insert into agencies (id, name, description, categories) values
  ('streets',    'LA Streets & 311',                 'Potholes, streetlights, traffic signals, sidewalks, fallen trees and downed lines.', '{INFRASTRUCTURE}'),
  ('police',     'LAPD Non-Emergency',               'Non-emergency crime, vandalism, suspicious activity and abandoned vehicles.',        '{PUBLIC_SAFETY}'),
  ('sanitation', 'LA Sanitation & Environment',      'Illegal dumping, graffiti, overflowing trash, spills and street flooding.',         '{ENVIRONMENTAL}'),
  ('outreach',   'Community Food & Shelter Network', 'Food, shelter, and outreach for residents who need support.',                       '{HUMAN_SERVICES}'),
  ('animals',    'LA Animal Services',               'Stray, aggressive, injured or dead animals.',                                       '{ANIMAL_CONTROL}');

-- Conversation ids follow the ticket id: c0000000-...-000000000101 belongs to ticket 101.
insert into conversations (id, phone, channel, state, questions_asked, created_at, updated_at) values
  ('c0000000-0000-4000-8000-000000000101', '+12135550101', 'sms', 'submitted', 1, now() - interval '180 min',  now() - interval '120 min'),
  ('c0000000-0000-4000-8000-000000000102', '+12135550102', 'sms', 'submitted', 1, now() - interval '12 min',   now() - interval '10 min'),
  ('c0000000-0000-4000-8000-000000000103', '+12135550103', 'sms', 'submitted', 0, now() - interval '25 min',   now() - interval '20 min'),
  ('c0000000-0000-4000-8000-000000000104', '+12135550104', 'sms', 'submitted', 0, now() - interval '300 min',  now() - interval '299 min'),
  ('c0000000-0000-4000-8000-000000000105', '+12135550105', 'sms', 'submitted', 0, now() - interval '1440 min', now() - interval '600 min'),
  ('c0000000-0000-4000-8000-000000000106', '+12135550106', 'sms', 'submitted', 1, now() - interval '600 min',  now() - interval '598 min'),
  ('c0000000-0000-4000-8000-000000000107', '+12135550107', 'sms', 'submitted', 1, now() - interval '70 min',   now() - interval '67 min'),
  ('c0000000-0000-4000-8000-000000000108', '+12135550108', 'sms', 'submitted', 0, now() - interval '2000 min', now() - interval '1999 min'),
  ('c0000000-0000-4000-8000-000000000109', '+12135550109', 'sms', 'submitted', 0, now() - interval '150 min',  now() - interval '149 min'),
  ('c0000000-0000-4000-8000-000000000110', '+12135550110', 'sms', 'submitted', 1, now() - interval '55 min',   now() - interval '52 min'),
  ('c0000000-0000-4000-8000-000000000111', '+12135550111', 'sms', 'submitted', 0, now() - interval '1300 min', now() - interval '900 min'),
  ('c0000000-0000-4000-8000-000000000112', '+12135550112', 'sms', 'submitted', 0, now() - interval '95 min',   now() - interval '94 min'),
  ('c0000000-0000-4000-8000-000000000113', '+12135550113', 'sms', 'submitted', 0, now() - interval '40 min',   now() - interval '39 min'),
  ('c0000000-0000-4000-8000-000000000114', '+12135550114', 'sms', 'submitted', 0, now() - interval '20 min',   now() - interval '20 min'),
  ('c0000000-0000-4000-8000-000000000115', '+12135550114', 'sms', 'submitted', 0, now() - interval '18 min',   now() - interval '18 min'),
  ('c0000000-0000-4000-8000-000000000116', '+12135550116', 'sms', 'submitted', 1, now() - interval '35 min',   now() - interval '32 min');

insert into tickets (
  id, conversation_id, phone, agency_id, category, subcategory, summary, suggested_action,
  location_text, lat, lng, hazard_type, people_involved, priority, priority_reason, is_emergency,
  credibility, credibility_reason, duplicate_of, report_count, priority_score, analyzed_at, status, created_at, updated_at
) overriding system value values
  (101, 'c0000000-0000-4000-8000-000000000101', '+12135550101', 'streets', 'INFRASTRUCTURE', 'pothole',
   'Large pothole in the right lane of Figueroa St at Jefferson Blvd; cars swerving around it.',
   'Send a patch crew; place cones in the right lane until it is filled.',
   'Figueroa St & Jefferson Blvd, Los Angeles', 34.0222, -118.2806, 'road hazard', null,
   'HIGH', 'Raised from MEDIUM: 3 residents reported it and one car got a flat tire.', false,
   'ok', null, null, 3, 90, now() - interval '40 min', 'in_progress', now() - interval '180 min', now() - interval '40 min'),

  (102, 'c0000000-0000-4000-8000-000000000102', '+12135550102', 'animals', 'ANIMAL_CONTROL', 'aggressive stray dog',
   'Aggressive loose dog near the elementary school at W 30th St & Hoover St during recess.',
   'Dispatch animal control now; alert the school office to keep students inside.',
   'W 30th St & Hoover St, Los Angeles', 34.0289, -118.2857, 'aggressive animal', null,
   'HIGH', 'Aggressive loose animal near children.', false,
   'ok', null, null, 1, 70, now() - interval '10 min', 'new', now() - interval '12 min', now() - interval '10 min'),

  (103, 'c0000000-0000-4000-8000-000000000103', '+12135550103', 'streets', 'INFRASTRUCTURE', 'tree on power line',
   'Tree branch down on a power line at Menlo Ave & W 35th St, sparking.',
   'Caller told to call 911. Notify LADWP; close the block until the line is de-energized.',
   'Menlo Ave & W 35th St, Los Angeles', 34.0204, -118.2921, 'sparking power line', null,
   'CRITICAL', 'Sparking power line is an immediate risk to life.', true,
   'ok', null, null, 1, 100, now() - interval '24 min', 'in_progress', now() - interval '25 min', now() - interval '20 min'),

  (104, 'c0000000-0000-4000-8000-000000000104', '+12135550104', 'sanitation', 'ENVIRONMENTAL', 'illegal dumping',
   'Three mattresses and a couch dumped in the alley behind W 27th St & Severance St, blocking the alley.',
   'Schedule a bulky-item pickup; check nearby cameras for the dumper.',
   'W 27th St & Severance St, Los Angeles', 34.0307, -118.2775, 'blocked alley', null,
   'MEDIUM', 'Blocks alley access but no immediate danger.', false,
   'ok', null, null, 1, 40, now() - interval '299 min', 'new', now() - interval '300 min', now() - interval '299 min'),

  (105, 'c0000000-0000-4000-8000-000000000105', '+12135550105', 'sanitation', 'ENVIRONMENTAL', 'graffiti',
   'Graffiti tagged on the bus shelter at Vermont Ave & Exposition Blvd.',
   'Add to the graffiti removal route.',
   'Vermont Ave & Exposition Blvd, Los Angeles', 34.0183, -118.2916, null, null,
   'LOW', 'Cosmetic issue.', false,
   'ok', null, null, 1, 10, now() - interval '1439 min', 'resolved', now() - interval '1440 min', now() - interval '600 min'),

  (106, 'c0000000-0000-4000-8000-000000000106', '+12135550106', 'streets', 'INFRASTRUCTURE', 'broken streetlight',
   'Streetlight out at W Adams Blvd & Hoover St; the corner is completely dark at night.',
   'Create a streetlight repair order; the dark corner is next to a bus stop.',
   'W Adams Blvd & Hoover St, Los Angeles', 34.0328, -118.2840, 'poor visibility', null,
   'MEDIUM', 'Dark corner near a bus stop is a safety concern at night.', false,
   'ok', null, null, 1, 40, now() - interval '598 min', 'new', now() - interval '600 min', now() - interval '598 min'),

  (107, 'c0000000-0000-4000-8000-000000000107', '+12135550107', 'outreach', 'HUMAN_SERVICES', 'person needs shelter',
   'Older man sleeping outside near the Exposition Park Rose Garden entrance, no jacket, asked for food.',
   'Send an outreach worker with food and a blanket; offer a shelter bed for tonight.',
   'Exposition Park Rose Garden, Los Angeles', 34.0168, -118.2857, null, 1,
   'MEDIUM', 'Vulnerable person; cold night expected.', false,
   'ok', null, null, 1, 40, now() - interval '67 min', 'new', now() - interval '70 min', now() - interval '67 min'),

  (108, 'c0000000-0000-4000-8000-000000000108', '+12135550108', 'police', 'PUBLIC_SAFETY', 'abandoned vehicle',
   'Silver sedan with flat tires parked at W 37th St & S Budlong Ave for over two weeks.',
   'Tag the vehicle for a 72-hour notice.',
   'W 37th St & S Budlong Ave, Los Angeles', 34.0187, -118.2955, null, null,
   'LOW', 'No hazard; long-term parking issue.', false,
   'ok', null, null, 1, 10, now() - interval '1999 min', 'new', now() - interval '2000 min', now() - interval '1999 min'),

  (109, 'c0000000-0000-4000-8000-000000000109', '+12135550109', 'police', 'PUBLIC_SAFETY', 'car break-ins',
   'Two cars with smashed windows on Jefferson Blvd near McClintock Ave; glass on the sidewalk.',
   'File a property crime report; increase patrols near the parking structure tonight.',
   'Jefferson Blvd & McClintock Ave, Los Angeles', 34.0222, -118.2870, 'broken glass', null,
   'MEDIUM', 'Property crime already happened; no one hurt.', false,
   'ok', null, null, 1, 40, now() - interval '149 min', 'new', now() - interval '150 min', now() - interval '149 min'),

  (110, 'c0000000-0000-4000-8000-000000000110', '+12135550110', 'streets', 'INFRASTRUCTURE', 'water main leak',
   'Water gushing from the street at W 29th St & Orchard Ave, flooding one lane.',
   'Notify LADWP water crew; put up flood warning signs.',
   'W 29th St & Orchard Ave, Los Angeles', 34.0296, -118.2829, 'flooding', null,
   'HIGH', 'Active flooding across a lane; likely to spread.', false,
   'ok', null, null, 1, 70, now() - interval '52 min', 'new', now() - interval '55 min', now() - interval '52 min'),

  (111, 'c0000000-0000-4000-8000-000000000111', '+12135550111', 'animals', 'ANIMAL_CONTROL', 'dead animal',
   'Dead raccoon on the sidewalk at Exposition Blvd & Bill Robertson Ln.',
   'Schedule dead animal pickup.',
   'Exposition Blvd & Bill Robertson Ln, Los Angeles', 34.0177, -118.2838, null, null,
   'LOW', 'Sanitation issue, no danger.', false,
   'ok', null, null, 1, 10, now() - interval '1299 min', 'resolved', now() - interval '1300 min', now() - interval '900 min'),

  (112, 'c0000000-0000-4000-8000-000000000112', '+12135550112', 'streets', 'INFRASTRUCTURE', 'pothole',
   'Pothole on Figueroa near Jefferson gave the reporter a flat tire.',
   'Same incident as #101.',
   'Figueroa St & Jefferson Blvd, Los Angeles', 34.0225, -118.2803, 'road hazard', null,
   'HIGH', 'Caused vehicle damage.', false,
   'ok', null, 101, 1, 70, now() - interval '94 min', 'new', now() - interval '95 min', now() - interval '94 min'),

  (113, 'c0000000-0000-4000-8000-000000000113', '+12135550113', 'streets', 'INFRASTRUCTURE', 'pothole',
   'Large pothole at Figueroa & Jefferson (reported in Spanish).',
   'Same incident as #101.',
   'Figueroa St & Jefferson Blvd, Los Angeles', 34.0221, -118.2808, 'road hazard', null,
   'MEDIUM', 'Road hazard.', false,
   'ok', null, 101, 1, 40, now() - interval '39 min', 'new', now() - interval '40 min', now() - interval '39 min'),

  (114, 'c0000000-0000-4000-8000-000000000114', '+12135550114', 'streets', 'INFRASTRUCTURE', 'test message',
   'Message contains no real report.',
   'No action.',
   null, null, null, null, null,
   'LOW', 'No reportable issue.', false,
   'spam', 'Test/joke message with no problem or location.', null, 1, 0, now() - interval '20 min', 'new', now() - interval '20 min', now() - interval '20 min'),

  (115, 'c0000000-0000-4000-8000-000000000115', '+12135550114', 'police', 'PUBLIC_SAFETY', 'stolen bike',
   'Says a bike was stolen on Trousdale Pkwy; no details given.',
   'Verify before acting: ask for time, bike description and exact spot.',
   'Trousdale Pkwy, Los Angeles', 34.0205, -118.2855, null, null,
   'LOW', 'Possible property crime, details missing.', false,
   'suspicious', 'Same number sent a test message 2 minutes earlier and gave no details.', null, 1, 10, now() - interval '18 min', 'new', now() - interval '18 min', now() - interval '18 min'),

  (116, 'c0000000-0000-4000-8000-000000000116', '+12135550116', 'outreach', 'HUMAN_SERVICES', 'food assistance',
   'Family of four at W 36th St & S Normandie Ave needs groceries after a job loss (reported in Spanish).',
   'Connect the family with the nearest food pantry; send a Spanish-speaking caseworker.',
   'W 36th St & S Normandie Ave, Los Angeles', 34.0215, -118.3003, null, 4,
   'MEDIUM', 'Family without food, including children.', false,
   'ok', null, null, 1, 40, now() - interval '32 min', 'new', now() - interval '35 min', now() - interval '32 min');

-- Keep the id sequence ahead of the seeded ids.
select setval(pg_get_serial_sequence('tickets', 'id'), (select max(id) from tickets));

update conversations c set ticket_id = t.id from tickets t where t.conversation_id = c.id;

insert into messages (conversation_id, sender, body, created_at) values
  ('c0000000-0000-4000-8000-000000000101', 'reporter', 'huge pothole on figueroa, cars are swerving into the next lane', now() - interval '180 min'),
  ('c0000000-0000-4000-8000-000000000101', 'bot',      'What is the nearest cross street on Figueroa?', now() - interval '180 min'),
  ('c0000000-0000-4000-8000-000000000101', 'reporter', 'right at jefferson, by the USC entrance', now() - interval '178 min'),
  ('c0000000-0000-4000-8000-000000000101', 'bot',      'Thanks! Report #101 sent to LA Streets & 311 (MEDIUM priority). We''ll text you updates. Reply STATUS to check, NEW to report something else.', now() - interval '178 min'),
  ('c0000000-0000-4000-8000-000000000101', 'agency',   'Update on #101: a patch crew is scheduled for this afternoon. Thanks for reporting!', now() - interval '40 min'),

  ('c0000000-0000-4000-8000-000000000102', 'reporter', 'there''s an aggressive dog near the elementary school on 30th street, kids are outside for recess', now() - interval '12 min'),
  ('c0000000-0000-4000-8000-000000000102', 'bot',      'Is the dog contained or running loose? And what''s the nearest cross street?', now() - interval '12 min'),
  ('c0000000-0000-4000-8000-000000000102', 'reporter', 'running loose, 30th and hoover', now() - interval '10 min'),
  ('c0000000-0000-4000-8000-000000000102', 'bot',      'Thanks! Report #102 sent to LA Animal Services (HIGH priority). We''ll text you updates. Reply STATUS to check, NEW to report something else.', now() - interval '10 min'),

  ('c0000000-0000-4000-8000-000000000103', 'reporter', 'tree branch fell on the power line at menlo and 35th, there are sparks', now() - interval '25 min'),
  ('c0000000-0000-4000-8000-000000000103', 'bot',      'If anyone is in danger, CALL 911 NOW. This line is not monitored for emergencies. We''ve also logged report #103.', now() - interval '25 min'),
  ('c0000000-0000-4000-8000-000000000103', 'agency',   'Update on #103: LADWP has been notified and the block is being closed. Please stay away from the line.', now() - interval '20 min'),

  ('c0000000-0000-4000-8000-000000000104', 'reporter', 'someone dumped 3 mattresses and a couch in the alley behind 27th and severance, cant get my car out', now() - interval '300 min'),
  ('c0000000-0000-4000-8000-000000000104', 'bot',      'Thanks! Report #104 sent to LA Sanitation & Environment (MEDIUM priority). We''ll text you updates. Reply STATUS to check, NEW to report something else.', now() - interval '299 min'),

  ('c0000000-0000-4000-8000-000000000105', 'reporter', 'graffiti all over the bus shelter at vermont and expo', now() - interval '1440 min'),
  ('c0000000-0000-4000-8000-000000000105', 'bot',      'Thanks! Report #105 sent to LA Sanitation & Environment (LOW priority). We''ll text you updates. Reply STATUS to check, NEW to report something else.', now() - interval '1439 min'),
  ('c0000000-0000-4000-8000-000000000105', 'agency',   'Update on #105: the graffiti has been removed. Thanks for reporting!', now() - interval '600 min'),

  ('c0000000-0000-4000-8000-000000000106', 'reporter', 'streetlight is out on adams', now() - interval '600 min'),
  ('c0000000-0000-4000-8000-000000000106', 'bot',      'Which cross street on Adams is the light near?', now() - interval '600 min'),
  ('c0000000-0000-4000-8000-000000000106', 'reporter', 'hoover, right by the bus stop. totally dark at night', now() - interval '598 min'),
  ('c0000000-0000-4000-8000-000000000106', 'bot',      'Thanks! Report #106 sent to LA Streets & 311 (MEDIUM priority). We''ll text you updates. Reply STATUS to check, NEW to report something else.', now() - interval '598 min'),

  ('c0000000-0000-4000-8000-000000000107', 'reporter', 'older man sleeping outside by the rose garden at expo park, no jacket, he asked me for food', now() - interval '70 min'),
  ('c0000000-0000-4000-8000-000000000107', 'bot',      'Thanks for looking out for him. Does he seem hurt or in need of medical help?', now() - interval '70 min'),
  ('c0000000-0000-4000-8000-000000000107', 'reporter', 'no hes ok just cold and hungry', now() - interval '67 min'),
  ('c0000000-0000-4000-8000-000000000107', 'bot',      'Thanks! Report #107 sent to Community Food & Shelter Network (MEDIUM priority). We''ll text you updates. Reply STATUS to check, NEW to report something else.', now() - interval '67 min'),

  ('c0000000-0000-4000-8000-000000000108', 'reporter', 'silver car with flat tires has been parked at 37th and budlong for 2+ weeks', now() - interval '2000 min'),
  ('c0000000-0000-4000-8000-000000000108', 'bot',      'Thanks! Report #108 sent to LAPD Non-Emergency (LOW priority). We''ll text you updates. Reply STATUS to check, NEW to report something else.', now() - interval '1999 min'),

  ('c0000000-0000-4000-8000-000000000109', 'reporter', '2 cars got their windows smashed on jefferson near mcclintock, glass everywhere', now() - interval '150 min'),
  ('c0000000-0000-4000-8000-000000000109', 'bot',      'Thanks! Report #109 sent to LAPD Non-Emergency (MEDIUM priority). We''ll text you updates. Reply STATUS to check, NEW to report something else.', now() - interval '149 min'),

  ('c0000000-0000-4000-8000-000000000110', 'reporter', 'water is gushing out of the street on 29th', now() - interval '55 min'),
  ('c0000000-0000-4000-8000-000000000110', 'bot',      'What''s the nearest cross street on 29th?', now() - interval '55 min'),
  ('c0000000-0000-4000-8000-000000000110', 'reporter', 'orchard ave. its flooding a whole lane', now() - interval '52 min'),
  ('c0000000-0000-4000-8000-000000000110', 'bot',      'Thanks! Report #110 sent to LA Streets & 311 (HIGH priority). We''ll text you updates. Reply STATUS to check, NEW to report something else.', now() - interval '52 min'),

  ('c0000000-0000-4000-8000-000000000111', 'reporter', 'dead raccoon on the sidewalk at expo and bill robertson', now() - interval '1300 min'),
  ('c0000000-0000-4000-8000-000000000111', 'bot',      'Thanks! Report #111 sent to LA Animal Services (LOW priority). We''ll text you updates. Reply STATUS to check, NEW to report something else.', now() - interval '1299 min'),
  ('c0000000-0000-4000-8000-000000000111', 'agency',   'Update on #111: this has been picked up. Thanks for reporting!', now() - interval '900 min'),

  ('c0000000-0000-4000-8000-000000000112', 'reporter', 'pothole on fig near jefferson just gave me a flat tire', now() - interval '95 min'),
  ('c0000000-0000-4000-8000-000000000112', 'bot',      'Thanks! This was already reported as #101. We''ve added yours and raised its priority. We''ll text you updates.', now() - interval '94 min'),

  ('c0000000-0000-4000-8000-000000000113', 'reporter', 'hay un bache enorme en figueroa y jefferson', now() - interval '40 min'),
  ('c0000000-0000-4000-8000-000000000113', 'bot',      '¡Gracias! Este problema ya fue reportado como #101. Agregamos su reporte y subimos su prioridad.', now() - interval '39 min'),

  ('c0000000-0000-4000-8000-000000000114', 'reporter', 'lol test test is this thing on', now() - interval '20 min'),
  ('c0000000-0000-4000-8000-000000000114', 'bot',      'Thanks for your message. To report a problem, tell us what is happening and where.', now() - interval '20 min'),

  ('c0000000-0000-4000-8000-000000000115', 'reporter', 'someone stole my bike on trousdale', now() - interval '18 min'),
  ('c0000000-0000-4000-8000-000000000115', 'bot',      'Thanks! Report #115 sent to LAPD Non-Emergency (LOW priority). We''ll text you updates. Reply STATUS to check, NEW to report something else.', now() - interval '18 min'),

  ('c0000000-0000-4000-8000-000000000116', 'reporter', 'mi familia necesita comida, somos 4 y mi esposo perdió su trabajo', now() - interval '35 min'),
  ('c0000000-0000-4000-8000-000000000116', 'bot',      '¿Cuál es la calle o intersección más cercana donde están?', now() - interval '35 min'),
  ('c0000000-0000-4000-8000-000000000116', 'reporter', 'calle 36 y normandie', now() - interval '32 min'),
  ('c0000000-0000-4000-8000-000000000116', 'bot',      'Thanks! Report #116 sent to Community Food & Shelter Network (MEDIUM priority). We''ll text you updates. Reply STATUS to check, NEW to report something else.', now() - interval '32 min');
