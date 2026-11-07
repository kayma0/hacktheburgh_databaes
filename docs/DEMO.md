# 3-minute demo script

**0:00 Problem (30s).** Hundreds of thousands of children are born with SCD in sub-Saharan Africa each year, most
undiagnosed, and blood is scarce. Charities running donation drives have to decide where to go and how big to go,
with numbers that are deeply uncertain. Most tools hide that uncertainty. We show it.

**0:30 Overview (40s).** Map of modelled units to raise per year. Toggle *Show uncertainty*: the map changes completely,
because the source estimates are very wide. Point at the ranked list: P50 with P10–P90, and *P(top 10)*, the chance a
country is a top-10 priority across 10,000 simulations. Point at an **ML-IMPUTED** badge: "we never mix guesses with data
silently."

**1:10 Scenario Lab (40s).** Move *share diagnosed* up: demand rises, because diagnosing children reveals need. Then
*universal diagnosis + hydroxyurea*: show units avoided. Tornado: "the biggest driver is an assumption we flag in amber,
which tells funders exactly which number to go and measure."

**1:50 Drive Planner (40s).** Pick a country and region, 4 drives/month, name the national blood transfusion service,
tick the licensed box (the app refuses without it). Show the probability of reaching the target and the fan chart.
Export CSV and print the one-page brief, both stamped MODELLED ESTIMATE.

**2:30 Field briefing (20s).** Generate for the same place and month. Show GROUNDED / UNGROUNDED status, confidence per
item, and "verify with" on every line.

**2:50 Close (10s).** Method page: leave-one-country-out cross-validation and the limitations we know about.

Backup: if wifi dies, run `make demo` (placeholder data, red banner) and say so out loud.
