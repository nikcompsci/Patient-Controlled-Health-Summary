(function () {
  "use strict";

  var STORAGE_KEY = "patientHealthSummaryData";
  var SELECTION_KEY = "patientHealthSummarySelections";
  var sections = {
    allergies: { title: "Allergies and Reactions", resource: "AllergyIntolerance" },
    medications: { title: "Current Medications", resource: "MedicationRequest" },
    conditions: { title: "Medical Conditions", resource: "Condition" },
    observations: { title: "Recent Results", resource: "Observation" },
    immunizations: { title: "Immunizations", resource: "Immunization" },
    procedures: { title: "Procedures", resource: "Procedure" }
  };

  var page = document.body.getAttribute("data-page");
  if (page === "summary") { initializeSummary(); }
  if (page === "choice") { initializeChoices(); }

  // Restores the SMART session, reads Patient and each supported resource once, and shows identity before the selected summary sections.
  // Patient.name and Patient.birthDate provide identity; Bundle.entry contains the matching resources for each section.
  function initializeSummary() {
    var cached = readStoredData();
    if (cached) {
      showSummary(cached);
      return;
    }

    // FHIR.oauth2.ready() restores the authorization granted by the SMART server; its client connects requests to that server with the patient-scoped token.
    // A successful result contains the authorized patient id and shows a loading message until identity and summary data are ready.
    FHIR.oauth2.ready().then(function (client) {
      setLoading("Loading your health record…", true);
      return retrieveAllData(client).then(function (data) {
        storeData(data);
        if (readSelections().length) {
          showSummary(data);
        } else {
          location.replace("./choice.html");
        }
      });
    }).catch(function () {
      showSignedOut("We could not load your health record. Please sign in again.");
    });
  }

  // Reads the authenticated Patient and six patient-specific FHIR searches using the id supplied by the SMART client.
  // client.patient.read() returns Patient fields such as name and birthDate; each client.request() response is a FHIR Bundle with resource entries.
  function retrieveAllData(client) {
    return client.patient.read().then(function (patient) {
      var patientId = client.patient.id;
      var resources = Object.keys(sections);
      var requests = resources.map(function (key) {
        var type = sections[key].resource;
        // The patient search uses the SMART patient id; the relevant patient/<Resource>.read scope permits this read-only FHIR request.
        // The server returns a Bundle; Bundle.entry.resource contains each resource, and an empty/missing entry list becomes an empty section.
        return client.request(type + "?patient=" + encodeURIComponent(patientId) + "&_count=100")
          .then(function (bundle) { return { key: key, entries: bundleEntries(bundle) }; })
          .catch(function () { return { key: key, entries: [] }; });
      });
      return Promise.all(requests).then(function (results) {
        var data = { patient: patient || {}, resources: {}, retrievedAt: new Date().toISOString() };
        results.forEach(function (result) { data.resources[result.key] = result.entries; });
        return data;
      });
    });
  }

  // Extracts resources from a FHIR search Bundle without assuming entries or resource fields are present.
  // It reads Bundle.entry[].resource and returns an empty list for absent data, so the patient sees “No entries found.”
  function bundleEntries(bundle) {
    if (!bundle || !Array.isArray(bundle.entry)) { return []; }
    return bundle.entry.map(function (entry) { return entry && entry.resource; }).filter(Boolean);
  }

  // Opens the choice page only when the patient data saved in this browser session is available.
  // It reads the stored patient/resource data and shows a friendly sign-in message when the session cache is missing.
  function initializeChoices() {
    var data = readStoredData();
    if (!data) {
      showSignedOut("Your record is not available in this session. Sign in to retrieve it.");
      return;
    }
    document.getElementById("loading").hidden = true;
    document.getElementById("choice-panel").hidden = false;
    var selections = readSelections();
    document.querySelectorAll('input[name="sections"]').forEach(function (input) {
      input.checked = selections.indexOf(input.value) !== -1;
    });
    document.getElementById("choice-form").addEventListener("submit", function (event) {
      event.preventDefault();
      var selected = Array.prototype.slice.call(document.querySelectorAll('input[name="sections"]:checked'))
        .map(function (input) { return input.value; });
      if (!selected.length) {
        document.getElementById("choice-error").hidden = false;
        return;
      }
      sessionStorage.setItem(SELECTION_KEY, JSON.stringify(selected));
      location.href = "./index.html";
    });
  }

  // Renders patient identity first and only the sections selected on the choice page.
  // It reads Patient.name, Patient.birthDate, the saved selection list, and each resource's available fields; empty sections show “No entries found.”
  function showSummary(data) {
    var patient = data.patient || {};
    var displayName = patientName(patient);
    document.getElementById("loading").hidden = true;
    document.getElementById("signed-out").hidden = true;
    document.getElementById("identity").hidden = false;
    document.getElementById("page-title").textContent = displayName === "Name not recorded"
      ? "Your Health Record Summary" : displayName + "’s Health Record Summary";
    document.getElementById("patient-name").textContent = displayName;
    document.getElementById("patient-birth-date").textContent = patient.birthDate || "Not recorded";
    document.getElementById("signed-in-actions").hidden = false;

    var selected = readSelections();
    var summary = document.getElementById("summary");
    var container = document.getElementById("summary-sections");
    container.replaceChildren();
    if (!selected.length) {
      summary.hidden = true;
      location.replace("./choice.html");
      return;
    }
    selected.forEach(function (key) {
      if (sections[key]) { container.appendChild(renderSection(key, data.resources && data.resources[key])); }
    });
    document.getElementById("summary-title").textContent = "Here is the information you selected from your most recent patient record";
    summary.hidden = false;
  }

  // Builds one selected section from resource entries, displaying available values or a clear empty state.
  // Resource-specific fields are read defensively, so missing values do not prevent the rest of the section from appearing.
  function renderSection(key, resources) {
    var section = document.createElement("section");
    section.className = "summary-card";
    var heading = document.createElement("h3");
    heading.textContent = sections[key].title;
    section.appendChild(heading);
    if (!Array.isArray(resources) || resources.length === 0) {
      section.appendChild(textParagraph("No entries found."));
      return section;
    }
    var list = document.createElement("div");
    list.className = "entry-list";
    resources.forEach(function (resource) {
      var entry = renderEntry(key, resource || {});
      if (entry) { list.appendChild(entry); }
    });
    if (!list.childElementCount) { section.appendChild(textParagraph("No entries found.")); }
    else { section.appendChild(list); }
    return section;
  }

  // Converts a FHIR resource into a readable entry with only fields present in that resource.
  // It reads type-specific names, statuses, dates, quantities, reactions, and codes that patients should see in the selected section.
  function renderEntry(key, resource) {
    var title = resourceTitle(key, resource);
    var fields = [];
    if (key === "allergies") {
      add(fields, "Clinical status", codeable(resource.clinicalStatus)); add(fields, "Verification status", codeable(resource.verificationStatus));
      add(fields, "Criticality", resource.criticality); add(fields, "Recorded date", resource.recordedDate);
      (Array.isArray(resource.reaction) ? resource.reaction : []).forEach(function (reaction) {
        add(fields, "Reaction", firstCode(reaction.manifestation)); add(fields, "Severity", reaction.severity);
      });
    } else if (key === "medications") {
      add(fields, "Status", resource.status); add(fields, "Dosage", dosageText(resource.dosageInstruction));
      add(fields, "Authored date", resource.authoredOn);
      var requestPeriod = firstDosagePeriod(resource.dosageInstruction);
      add(fields, "Frequency", requestPeriod.frequency);
      add(fields, "Start date", requestPeriod.start);
    } else if (key === "conditions") {
      add(fields, "Clinical status", codeable(resource.clinicalStatus)); add(fields, "Verification status", codeable(resource.verificationStatus));
      add(fields, "Onset date", resource.onsetDateTime || resource.onsetPeriod && resource.onsetPeriod.start || resource.onsetString);
      add(fields, "Recorded date", resource.recordedDate);
    } else if (key === "observations") {
      add(fields, "Value", observationValue(resource)); add(fields, "Effective date", resource.effectiveDateTime || resource.effectivePeriod && (resource.effectivePeriod.start || resource.effectivePeriod.end) || resource.effectiveDate); 
      add(fields, "Issued date", resource.issued); add(fields, "Interpretation", firstCode(resource.interpretation));
      add(fields, "Reference range", referenceRange(resource.referenceRange));
    } else if (key === "immunizations") {
      add(fields, "Status", resource.status); add(fields, "Administration date", resource.occurrenceDateTime || resource.occurrenceString);
      add(fields, "Lot number", resource.lotNumber);
    } else if (key === "procedures") {
      add(fields, "Status", resource.status); add(fields, "Procedure date", resource.performedDateTime || resource.performedPeriod && (resource.performedPeriod.start || resource.performedPeriod.end));
      add(fields, "Performed date", resource.performedString);
    }
    var article = document.createElement("article");
    article.className = "entry";
    if (title) { var h = document.createElement("h4"); h.textContent = title; article.appendChild(h); }
    if (fields.length) {
      var dl = document.createElement("dl");
      fields.forEach(function (field) { var dt = document.createElement("dt"); dt.textContent = field.label; var dd = document.createElement("dd"); dd.textContent = field.value; dl.append(dt, dd); });
      article.appendChild(dl);
    }
    return title || fields.length ? article : null;
  }

  // Chooses a patient-readable display name from each supported FHIR resource's CodeableConcept or medication reference.
  // It reads code.text/coding.display, medicationCodeableConcept, and medicationReference.display; the resource name appears as the entry heading.
  function resourceTitle(key, resource) {
    var concept = resource.code || resource.vaccineCode || resource.medicationCodeableConcept || resource.medication;
    if (key === "allergies") { concept = resource.code; }
    if (key === "medications" && resource.medicationReference) { return resource.medicationReference.display || "Medication"; }
    if (key === "medications" && resource.medicationCodeableConcept) { concept = resource.medicationCodeableConcept; }
    return codeable(concept) || (key === "allergies" ? "Allergy or intolerance" : sections[key].resource);
  }

  // Reads a FHIR CodeableConcept's text or first available coding display, then uses code when display text is absent.
  // Patients see the best available plain-language name without the page failing on incomplete coding.
  function codeable(value) {
    if (!value) { return ""; }
    if (typeof value === "string") { return value; }
    if (value.text) { return value.text; }
    var codings = Array.isArray(value.coding) ? value.coding : [];
    for (var i = 0; i < codings.length; i += 1) {
      if (codings[i] && (codings[i].display || codings[i].code)) { return codings[i].display || codings[i].code; }
    }
    return "";
  }

  // Formats the Observation value[x] field, keeping quantity number and unit together when supplied.
  // It reads valueQuantity, valueCodeableConcept, valueString, valueBoolean, valueInteger, and valueDateTime for display with its unit.
  function observationValue(resource) {
    if (resource.valueQuantity) {
      var quantity = resource.valueQuantity;
      var number = quantity.value;
      if (number === undefined || number === null) { return ""; }
      return String(number) + (quantity.unit || quantity.code ? " " + (quantity.unit || quantity.code) : "");
    }
    if (resource.valueCodeableConcept) { return codeable(resource.valueCodeableConcept); }
    if (resource.valueString !== undefined) { return String(resource.valueString); }
    if (resource.valueBoolean !== undefined) { return resource.valueBoolean ? "Yes" : "No"; }
    if (resource.valueInteger !== undefined) { return String(resource.valueInteger); }
    if (resource.valueDateTime) { return resource.valueDateTime; }
    return "";
  }

  // Reads Dosage instruction text and doseAndRate values for a MedicationRequest.
  // It reads doseQuantity and route from dosageInstruction, showing dose and units when present.
  function dosageText(instructions) {
    if (!Array.isArray(instructions)) { return ""; }
    return instructions.map(function (item) {
      var pieces = [];
      if (item.text) { pieces.push(item.text); }
      (Array.isArray(item.doseAndRate) ? item.doseAndRate : []).forEach(function (dose) {
        if (dose.doseQuantity && dose.doseQuantity.value !== undefined) {
          pieces.push(String(dose.doseQuantity.value) + (dose.doseQuantity.unit ? " " + dose.doseQuantity.unit : ""));
        }
      });
      var route = codeable(item.route);
      if (route) { pieces.push("Route: " + route); }
      return pieces.join(" · ");
    }).filter(Boolean).join("; ");
  }

  // Reads dosage timing and boundsPeriod for a MedicationRequest's frequency and start date.
  // It reads repeat.frequency, repeat.period, repeat.periodUnit, repeat.boundsPeriod.start, and repeat.boundsPeriod.end for display.
  function firstDosagePeriod(instructions) {
    var item = Array.isArray(instructions) ? instructions[0] : null;
    var repeat = item && item.timing && item.timing.repeat;
    var frequency = repeat && repeat.frequency;
    var period = repeat && repeat.period;
    var unit = repeat && repeat.periodUnit;
    var frequencyText = frequency ? frequency + " time(s)" + (period && unit ? " every " + period + " " + unit : "") : "";
    return { frequency: frequencyText, start: repeat && repeat.boundsPeriod && repeat.boundsPeriod.start || "", end: repeat && repeat.boundsPeriod && repeat.boundsPeriod.end || "" };
  }

  // Joins reaction manifestation concepts and formats reference ranges with units when available.
  // It reads manifestation[].text/coding and referenceRange[].low/high; patients see reaction names and readable ranges.
  function firstCode(values) {
    return Array.isArray(values) ? values.map(codeable).filter(Boolean).join(", ") : codeable(values);
  }

  // Combines the low and high FHIR Quantity values and their units into readable reference ranges.
  // It reads referenceRange.low/high.value and unit; the patient sees only a range that is present.
  function referenceRange(ranges) {
    if (!Array.isArray(ranges)) { return ""; }
    return ranges.map(function (range) {
      function q(value) { return value && value.value !== undefined ? String(value.value) + (value.unit ? " " + value.unit : "") : ""; }
      var low = q(range.low); var high = q(range.high);
      if (low && high) { return low + "–" + high; }
      return low || high || range.text || "";
    }).filter(Boolean).join("; ");
  }

  // Adds a label/value pair only when the FHIR field has useful content.
  // This keeps incomplete records readable and prevents missing fields from creating empty rows.
  function add(list, label, value) {
    if (value === undefined || value === null || value === "") { return; }
    if (typeof value === "object") { value = codeable(value); }
    if (value !== "") { list.push({ label: label, value: String(value) }); }
  }

  // Formats Patient.name, which is a list whose preferred entry may be missing or incomplete.
  // It reads name.text, name.given, and name.family and shows a clear fallback if the record has no name.
  function patientName(patient) {
    var names = Array.isArray(patient.name) ? patient.name : [];
    var name = names.filter(function (item) { return item && item.use === "official"; })[0] || names[0];
    if (!name) { return "Name not recorded"; }
    if (name.text) { return name.text; }
    var given = Array.isArray(name.given) ? name.given.join(" ") : "";
    return (given + " " + (name.family || "")).trim() || "Name not recorded";
  }

  // Reads the patient/resource data previously retrieved for this browser session without making another FHIR request.
  // Invalid or missing stored JSON returns null so the page can show a sign-in message instead of a blank screen.
  function readStoredData() {
    try { var value = sessionStorage.getItem(STORAGE_KEY); return value ? JSON.parse(value) : null; }
    catch (error) { return null; }
  }

  // Saves the retrieved Patient and resource arrays for reuse when summary choices change.
  // It writes only read results to sessionStorage; the patient sees the same dataset until the browser session ends.
  function storeData(data) {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    catch (error) { throw new Error("Your browser could not save this session's health record."); }
  }

  // Reads the patient's selected section keys from sessionStorage and filters out unknown values.
  // The returned list controls which summary headings and resource entries appear.
  function readSelections() {
    try {
      var selected = JSON.parse(sessionStorage.getItem(SELECTION_KEY) || "[]");
      return Array.isArray(selected) ? selected.filter(function (key) { return Boolean(sections[key]); }) : [];
    } catch (error) { return []; }
  }

  // Shows or hides the loading status while the authenticated FHIR data is in flight.
  // It updates visible status text so the patient knows the record is being retrieved.
  function setLoading(message, visible) {
    var node = document.getElementById("loading");
    node.textContent = message;
    node.hidden = !visible;
  }

  // Displays sign-in links and a readable message when the SMART session or session data is unavailable.
  // It updates the page error text and shows the signed-out view instead of leaving an empty page.
  function showSignedOut(message) {
    setLoading("", false);
    document.getElementById("signed-out").hidden = false;
    var error = document.getElementById("page-error");
    error.textContent = message;
    error.hidden = false;
    document.getElementById("signed-in-actions").hidden = true;
  }

  // Creates a paragraph for a short patient-facing status message.
  // It sets plain text content so information is read safely by assistive technology and cannot be interpreted as HTML.
  function textParagraph(message) {
    var paragraph = document.createElement("p");
    paragraph.textContent = message;
    return paragraph;
  }

  // Signs the patient out of the SMART app and removes this app's cached patient data and choices.
  // It clears sessionStorage before returning to the signed-out home page, so the next visit requests fresh authorization.
  var signOut = document.getElementById("sign-out");
  if (signOut) {
    signOut.addEventListener("click", function (event) {
      event.preventDefault();
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(SELECTION_KEY);
      location.href = "./";
    });
  }
}());
