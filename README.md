# Patient-Controlled Health Summary

A patient-facing SMART on FHIR application that helps people retrieve a focused view of the information in their health record. Built as a static GitHub Pages site with no framework, build step, or backend.

## Problem statement

Patients often need one part of their health record without searching through the entire record. They may need recent lab results before an appointment, a medication list for a new clinician, allergy and reaction information, or several categories together.

## Solution

After the patient signs in through SMART on FHIR, the app reads their Patient resource and supported clinical resources from the connected FHIR R4 server. Patients choose the sections that matter to them and generate a focused summary from the data already retrieved for that browser session. Changing the selection does not make another FHIR request.

## Features

- SMART on FHIR patient authentication
- Patient-controlled summaries with selectable sections
- One initial read of each supported resource per browser session
- Multiple summaries from the same retrieved dataset
- Responsive, semantic HTML with keyboard-accessible controls
- Read-only FHIR access
- Graceful handling of empty and partially populated resources

## Architecture

```text
launch.html
    ↓ SMART authorization
index.html
    (read Patient and supported FHIR resources; cache for this session)
    ↓
choice.html
    (select desired sections; save choices in sessionStorage)
    ↓
index.html
    (display the selected summary from the cached dataset)
```

## FHIR resources used

- Patient
- AllergyIntolerance
- MedicationRequest
- Condition
- Observation
- Immunization
- Procedure

FHIR search responses are Bundles. The app reads `Bundle.entry[].resource` and safely treats missing entries as an empty list. A selected section without entries displays “No entries found.”

## Technologies

- SMART on FHIR
- HL7 FHIR R4
- JavaScript, HTML, and CSS
- [fhirclient 3.0.1](https://www.npmjs.com/package/fhirclient)
- GitHub Pages

## Screenshots

Add project screenshots here when available:

- `![Summary choices](screenshots/summary-choices.png)`
- `![Generated patient summary](screenshots/generated-summary.png)`

## Future enhancements

- Support additional FHIR resources and terminology displays
- Saved summary profiles
- QR code sharing
- SMART Health Links integration

## How to run

1. Publish the repository as a GitHub Pages site using the repository root as the source.
2. Register the deployed app URL as a redirect URI with the SMART authorization server you plan to use. The included launch page is configured for the public SMART Health IT R4 sandbox.
3. Open `launch.html`, sign in as a patient in the SMART sandbox, and approve access.
4. The sandbox returns to `index.html`; the app reads the patient record and opens the summary choices.

The app is static and requires no install, build, or backend. GitHub Pages URLs are typically `https://<owner>.github.io/<repository>/launch.html`; the health check is available at `/health.html`.

## SMART scopes required

The authorization request keeps the original scopes and adds read access for every supported resource:

```text
launch/patient openid fhirUser patient/Patient.read patient/AllergyIntolerance.read patient/MedicationRequest.read patient/Condition.read patient/Observation.read patient/Immunization.read patient/Procedure.read
```

Each `patient/<Resource>.read` scope permits patient-scoped read access to that resource type. The app does not create or update FHIR resources.

## Acknowledgements

- This project was a deliverable of the HL7 Break the Code program.
- Initial SMART on FHIR starter application concepts were provided by [William Laolagi](https://github.com/samoanGuy7/Smart-App).
- The project was expanded and customized into a patient-controlled health summary application using concepts learned through HL7 Break the Code.
- Additional guidance and instruction were provided by Daniel Bach and William Laolagi throughout the program.
- This project uses SMART on FHIR and HL7 FHIR R4 standards.

## Disclaimer

This application is a demonstrational SMART on FHIR project. It is intended to show a patient-controlled way to view selected health record information and does not replace professional medical advice, diagnosis, or treatment.
