const AUTH_KEY = 'eventManagement_auth';
const DEMO_USERNAME = 'admin';
const DEMO_PASSWORD = 'admin123';
const STORAGE_KEYS = {
  events: 'eventManagement_events',
  participants: 'eventManagement_participants',
  registrations: 'eventManagement_registrations',
  attendance: 'eventManagement_attendance',
};

const GOOGLE_SHEETS_API_URL = 'https://script.google.com/macros/s/AKfycbzY3HKZifSPz2GLt6fJpv3HZJdPIEl8bTHN9SCmgCkg3EUORUKXWfFso-tiKkdd9cVt/exec';
const API_ENTITY_BY_KEY = Object.fromEntries(Object.entries(STORAGE_KEYS).map(([entity, key]) => [key, entity]));

const app = document.querySelector('#app');

function getAuthState() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY)) ?? { isAuthenticated: false };
  } catch {
    return { isAuthenticated: false };
  }
}

function setAuthState(state) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(state));
}

function readCollection(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeCollection(key, value) {
  const previous = readCollection(key);
  localStorage.setItem(key, JSON.stringify(value));
  syncCollectionMutation(key, previous, value);
}

async function apiRequest(options) {
  const headers = options.method === 'GET' ? (options.headers || {}) : { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const response = await fetch(options.url || GOOGLE_SHEETS_API_URL, {
    ...options,
    headers,
  });
  const result = await response.json();
  if (!result.ok) throw new Error(result.error || 'Google Sheets request failed');
  return result.data;
}

async function syncCollectionMutation(key, previous, next) {
  const entity = API_ENTITY_BY_KEY[key];
  if (!entity) return;
  const idField = `${entity.slice(0, -1)}Id`;
  const oldById = new Map(previous.map((record) => [record[idField], record]));
  const newById = new Map(next.map((record) => [record[idField], record]));

  for (const record of next) {
    const oldRecord = oldById.get(record[idField]);
    if (!oldRecord) {
      apiRequest({ method: 'POST', body: JSON.stringify({ action: 'create', entity, record }) }).catch(() => {});
    } else if (JSON.stringify(oldRecord) !== JSON.stringify(record)) {
      apiRequest({ method: 'POST', body: JSON.stringify({ action: 'update', entity, id: record[idField], record }) }).catch(() => {});
    }
  }
  for (const record of previous) {
    if (!newById.has(record[idField])) {
      apiRequest({ method: 'POST', body: JSON.stringify({ action: 'delete', entity, id: record[idField] }) }).catch(() => {});
    }
  }
}

async function syncFromGoogleSheets() {
  await Promise.all(Object.keys(STORAGE_KEYS).filter((entity) => entity !== 'users').map(loadGoogleCollection));
}

async function loadGoogleCollection(entity) {
  try {
    const records = await apiRequest({ method: 'GET', url: `${GOOGLE_SHEETS_API_URL}?entity=${entity}`, headers: {} });
    if (Array.isArray(records) && (records.length > 0 || !localStorage.getItem(STORAGE_KEYS[entity]))) {
      localStorage.setItem(STORAGE_KEYS[entity], JSON.stringify(records));
    }
  } catch {
    // localStorage remains the fallback when the API is unavailable.
  }
}

function seedApplicationData() {
  const today = new Date();
  const upcomingDate = new Date(today);
  upcomingDate.setDate(today.getDate() + 14);
  const dateValue = upcomingDate.toISOString().slice(0, 10);

  if (!localStorage.getItem(STORAGE_KEYS.events)) {
    writeCollection(STORAGE_KEYS.events, [{
      eventId: 'event_001',
      eventName: 'Web Development Workshop',
      description: 'Introduction to modern frontend development.',
      date: dateValue,
      time: '09:00',
      location: 'Computer Lab 1',
      organizer: 'ICT Department',
      capacity: 30,
      status: 'Upcoming',
    }]);
  }
  if (!localStorage.getItem(STORAGE_KEYS.participants)) {
    writeCollection(STORAGE_KEYS.participants, [{
      participantId: 'participant_001',
      name: 'Aina Rahman',
      email: 'aina@example.com',
      phone: '012-3456789',
      organisation: 'Politeknik Kuching Sarawak',
    }]);
  }
  if (!localStorage.getItem(STORAGE_KEYS.registrations)) {
    writeCollection(STORAGE_KEYS.registrations, [{
      registrationId: 'registration_001',
      eventId: 'event_001',
      participantId: 'participant_001',
      registrationDate: today.toISOString().slice(0, 10),
      status: 'Registered',
    }]);
  }
  if (!localStorage.getItem(STORAGE_KEYS.attendance)) {
    writeCollection(STORAGE_KEYS.attendance, []);
  }
}

function formatDate(value) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00`));
}

function dashboardData() {
  const events = readCollection(STORAGE_KEYS.events);
  const participants = readCollection(STORAGE_KEYS.participants);
  const registrations = readCollection(STORAGE_KEYS.registrations);
  const attendance = readCollection(STORAGE_KEYS.attendance);
  const presentCount = attendance.filter((item) => item.status === 'Present').length;
  const attendanceRate = registrations.length ? Math.round((presentCount / registrations.length) * 100) : 0;
  const today = new Date().toISOString().slice(0, 10);

  return {
    events,
    participants,
    registrations,
    attendance,
    attendanceRate,
    upcomingEvents: events.filter((event) => event.status === 'Upcoming' && event.date >= today).sort((a, b) => a.date.localeCompare(b.date)),
    recentRegistrations: [...registrations].sort((a, b) => b.registrationDate.localeCompare(a.registrationDate)).slice(0, 5),
  };
}

function renderEventsPage() {
  const auth = getAuthState();
  if (!auth.isAuthenticated) {
    renderLogin();
    return;
  }

  let searchTerm = '';
  let statusFilter = 'All';
  let sortDirection = 'ascending';
  let editingEventId = '';
  let eventMessage = '';

  function drawEvents() {
    const events = readCollection(STORAGE_KEYS.events);
    const statuses = ['All', ...new Set(events.map((event) => event.status).filter(Boolean))];
    const filteredEvents = events
      .filter((event) => `${event.eventName} ${event.location}`.toLowerCase().includes(searchTerm.toLowerCase()))
      .filter((event) => statusFilter === 'All' || event.status === statusFilter)
      .sort((a, b) => sortDirection === 'ascending' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date));

    app.innerHTML = `
      <div class="app-shell">
        <header class="topbar">
          <div><p class="eyebrow">Event Management System</p><h1>Events</h1></div>
          <div class="user-area"><span>Signed in as <strong>${auth.username}</strong></span><button id="dashboard-button" class="button secondary" type="button">Dashboard</button><button id="logout-button" class="button secondary" type="button">Log out</button></div>
        </header>
        <main class="content">
          <section class="panel">
            <div class="panel-heading"><div><p class="eyebrow">Event management</p><h2>All Events</h2></div><div class="action-row"><button id="new-event" class="button primary" type="button">Add event</button><span class="muted">${filteredEvents.length} of ${events.length} shown</span></div></div>
            ${eventMessage ? `<p class="form-message error" role="alert">${eventMessage}</p>` : ''}
            ${editingEventId === 'new' || editingEventId ? `<form id="event-edit-form" class="crud-form"><label class="filter-field">Event name<input id="event-edit-name" required /></label><label class="filter-field">Date<input id="event-edit-date" type="date" required /></label><label class="filter-field">Time<input id="event-edit-time" type="time" required /></label><label class="filter-field">Location<input id="event-edit-location" required /></label><label class="filter-field">Capacity<input id="event-edit-capacity" type="number" min="1" required /></label><label class="filter-field">Status<select id="event-edit-status"><option>Draft</option><option>Upcoming</option><option>Ongoing</option><option>Completed</option><option>Cancelled</option></select></label><div class="action-row"><button class="button primary" type="submit">Save event</button><button class="button secondary" id="cancel-event-edit" type="button">Cancel</button></div></form>` : ''}
            <div class="filters" aria-label="Event filters">
              <label class="filter-field">Search<input id="event-search" type="search" placeholder="Search name or location" value="${searchTerm}" /></label>
              <label class="filter-field">Status<select id="event-status">${statuses.map((status) => `<option value="${status}" ${status === statusFilter ? 'selected' : ''}>${status}</option>`).join('')}</select></label>
              <label class="filter-field">Date sorting<select id="event-sort"><option value="ascending" ${sortDirection === 'ascending' ? 'selected' : ''}>Earliest first</option><option value="descending" ${sortDirection === 'descending' ? 'selected' : ''}>Latest first</option></select></label>
            </div>
            ${filteredEvents.length ? `<div class="table-wrap"><table><thead><tr><th>Event Name</th><th>Date</th><th>Time</th><th>Location</th><th>Capacity</th><th>Status</th><th>Registration Count</th><th>Actions</th></tr></thead><tbody>${filteredEvents.map((event) => `<tr><td><strong>${event.eventName}</strong></td><td>${formatDate(event.date)}</td><td>${event.time}</td><td>${event.location}</td><td>${event.capacity}</td><td><span class="status-badge">${event.status}</span></td><td>${eventsRegistrationCount(event.eventId)}</td><td><div class="row-actions"><button class="row-button edit-event" data-event-id="${event.eventId}" type="button">Edit</button><button class="row-button delete-event" data-event-id="${event.eventId}" type="button">Delete</button></div></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state"><h3>No events found</h3><p class="muted">Try changing the search or status filter.</p></div>'}
          </section>
        </main>
      </div>
    `;

    document.querySelector('#dashboard-button').addEventListener('click', renderProtectedApp);
    document.querySelector('#logout-button').addEventListener('click', () => {
      setAuthState({ isAuthenticated: false, userId: null, username: null, role: null });
      renderLogin();
    });
    document.querySelector('#event-search').addEventListener('input', (event) => { searchTerm = event.target.value; drawEvents(); });
    document.querySelector('#event-status').addEventListener('change', (event) => { statusFilter = event.target.value; drawEvents(); });
    document.querySelector('#event-sort').addEventListener('change', (event) => { sortDirection = event.target.value; drawEvents(); });
    document.querySelector('#new-event').addEventListener('click', () => { editingEventId = 'new'; eventMessage = ''; drawEvents(); });
    document.querySelectorAll('.edit-event').forEach((button) => button.addEventListener('click', () => { editingEventId = button.dataset.eventId; drawEvents(); }));
    if (editingEventId) {
      const target = readCollection(STORAGE_KEYS.events).find((item) => item.eventId === editingEventId);
      if (target) { document.querySelector('#event-edit-name').value = target.eventName; document.querySelector('#event-edit-date').value = target.date; document.querySelector('#event-edit-time').value = target.time; document.querySelector('#event-edit-location').value = target.location; document.querySelector('#event-edit-capacity').value = target.capacity; document.querySelector('#event-edit-status').value = target.status; }
      document.querySelector('#event-edit-form').addEventListener('submit', (event) => { event.preventDefault(); const allEvents = readCollection(STORAGE_KEYS.events); const form = new FormData(event.currentTarget); const name = String(form.get('name') ?? document.querySelector('#event-edit-name').value).trim(); const date = document.querySelector('#event-edit-date').value; const time = document.querySelector('#event-edit-time').value; const location = document.querySelector('#event-edit-location').value.trim(); const capacity = Number(document.querySelector('#event-edit-capacity').value); if (!name || !date || !time || !location || capacity <= 0) { eventMessage = 'Complete all required event fields and use a positive capacity.'; drawEvents(); return; } const record = { eventId: editingEventId === 'new' ? `event_${String(allEvents.length + 1).padStart(3, '0')}` : editingEventId, eventName: name, description: '', date, time, location, organizer: 'Admin', capacity, status: document.querySelector('#event-edit-status').value }; const index = allEvents.findIndex((item) => item.eventId === editingEventId); if (index >= 0) allEvents[index] = { ...allEvents[index], ...record }; else allEvents.push(record); writeCollection(STORAGE_KEYS.events, allEvents); editingEventId = ''; eventMessage = ''; drawEvents(); });
      document.querySelector('#cancel-event-edit').addEventListener('click', () => { editingEventId = ''; drawEvents(); });
    }
    document.querySelectorAll('.delete-event').forEach((button) => button.addEventListener('click', () => {
      if (!window.confirm('Delete this event and its registrations and attendance records?')) return;
      const eventId = button.dataset.eventId;
      writeCollection(STORAGE_KEYS.events, readCollection(STORAGE_KEYS.events).filter((item) => item.eventId !== eventId));
      writeCollection(STORAGE_KEYS.registrations, readCollection(STORAGE_KEYS.registrations).filter((item) => item.eventId !== eventId));
      writeCollection(STORAGE_KEYS.attendance, readCollection(STORAGE_KEYS.attendance).filter((item) => item.eventId !== eventId));
      drawEvents();
    }));
  }

  function eventsRegistrationCount(eventId) {
    return readCollection(STORAGE_KEYS.registrations).filter((registration) => registration.eventId === eventId).length;
  }

  drawEvents();
}

function renderParticipantsPage() {
  const auth = getAuthState();
  if (!auth.isAuthenticated) {
    renderLogin();
    return;
  }

  let searchTerm = '';
  let editingParticipantId = '';
  let participantMessage = '';

  function drawParticipants() {
    const participants = readCollection(STORAGE_KEYS.participants);
    const registrations = readCollection(STORAGE_KEYS.registrations);
    const filteredParticipants = participants.filter((participant) => `${participant.name} ${participant.email} ${participant.organisation}`.toLowerCase().includes(searchTerm.toLowerCase()));

    app.innerHTML = `
      <div class="app-shell">
        <header class="topbar">
          <div><p class="eyebrow">Event Management System</p><h1>Participants</h1></div>
          <div class="user-area"><span>Signed in as <strong>${auth.username}</strong></span><button id="dashboard-button" class="button secondary" type="button">Dashboard</button><button id="events-button" class="button secondary" type="button">Events</button><button id="logout-button" class="button secondary" type="button">Log out</button></div>
        </header>
        <main class="content">
          <section class="panel">
            <div class="panel-heading"><div><p class="eyebrow">Participant management</p><h2>All Participants</h2></div><div class="action-row"><button id="new-participant" class="button primary" type="button">Add participant</button><span class="muted">${filteredParticipants.length} of ${participants.length} shown</span></div></div>
            ${participantMessage ? `<p class="form-message error" role="alert">${participantMessage}</p>` : ''}
            ${editingParticipantId ? `<form id="participant-edit-form" class="crud-form"><label class="filter-field">Name<input id="participant-edit-name" required /></label><label class="filter-field">Email<input id="participant-edit-email" type="email" required /></label><label class="filter-field">Phone<input id="participant-edit-phone" /></label><label class="filter-field">Organisation<input id="participant-edit-organisation" /></label><div class="action-row"><button class="button primary" type="submit">Save participant</button><button class="button secondary" id="cancel-participant-edit" type="button">Cancel</button></div></form>` : ''}
            <div class="filters participants-filter" aria-label="Participant filters">
              <label class="filter-field">Search<input id="participant-search" type="search" placeholder="Search name, email or organisation" value="${searchTerm}" /></label>
            </div>
            ${filteredParticipants.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Organisation</th><th>Registration Count</th><th>Actions</th></tr></thead><tbody>${filteredParticipants.map((participant) => `<tr><td><strong>${participant.name}</strong></td><td>${participant.email}</td><td>${participant.phone || '—'}</td><td>${participant.organisation || '—'}</td><td>${registrations.filter((registration) => registration.participantId === participant.participantId).length}</td><td><div class="row-actions"><button class="row-button edit-participant" data-participant-id="${participant.participantId}" type="button">Edit</button><button class="row-button delete-participant" data-participant-id="${participant.participantId}" type="button">Delete</button></div></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state"><h3>No participants found</h3><p class="muted">Try changing your search.</p></div>'}
          </section>
        </main>
      </div>
    `;

    document.querySelector('#dashboard-button').addEventListener('click', renderProtectedApp);
    document.querySelector('#events-button').addEventListener('click', renderEventsPage);
    document.querySelector('#logout-button').addEventListener('click', () => {
      setAuthState({ isAuthenticated: false, userId: null, username: null, role: null });
      renderLogin();
    });
    document.querySelector('#participant-search').addEventListener('input', (event) => { searchTerm = event.target.value; drawParticipants(); });
    document.querySelector('#new-participant').addEventListener('click', () => { editingParticipantId = 'new'; participantMessage = ''; drawParticipants(); });
    document.querySelectorAll('.edit-participant').forEach((button) => button.addEventListener('click', () => { editingParticipantId = button.dataset.participantId; drawParticipants(); }));
    if (editingParticipantId) {
      const target = readCollection(STORAGE_KEYS.participants).find((item) => item.participantId === editingParticipantId);
      if (target) { document.querySelector('#participant-edit-name').value = target.name; document.querySelector('#participant-edit-email').value = target.email; document.querySelector('#participant-edit-phone').value = target.phone ?? ''; document.querySelector('#participant-edit-organisation').value = target.organisation ?? ''; }
      document.querySelector('#participant-edit-form').addEventListener('submit', (event) => { event.preventDefault(); const allParticipants = readCollection(STORAGE_KEYS.participants); const name = document.querySelector('#participant-edit-name').value.trim(); const email = document.querySelector('#participant-edit-email').value.trim(); const duplicate = allParticipants.some((item) => item.email.toLowerCase() === email.toLowerCase() && item.participantId !== editingParticipantId); if (!name || !email.includes('@')) { participantMessage = 'Name and a valid email are required.'; drawParticipants(); return; } if (duplicate) { participantMessage = 'A participant with this email already exists.'; drawParticipants(); return; } const record = { participantId: editingParticipantId === 'new' ? `participant_${String(allParticipants.length + 1).padStart(3, '0')}` : editingParticipantId, name, email, phone: document.querySelector('#participant-edit-phone').value.trim(), organisation: document.querySelector('#participant-edit-organisation').value.trim() }; const index = allParticipants.findIndex((item) => item.participantId === editingParticipantId); if (index >= 0) allParticipants[index] = { ...allParticipants[index], ...record }; else allParticipants.push(record); writeCollection(STORAGE_KEYS.participants, allParticipants); editingParticipantId = ''; participantMessage = ''; drawParticipants(); });
      document.querySelector('#cancel-participant-edit').addEventListener('click', () => { editingParticipantId = ''; drawParticipants(); });
    }
    document.querySelectorAll('.delete-participant').forEach((button) => button.addEventListener('click', () => {
      if (!window.confirm('Delete this participant and related registrations and attendance records?')) return;
      const participantId = button.dataset.participantId;
      writeCollection(STORAGE_KEYS.participants, readCollection(STORAGE_KEYS.participants).filter((item) => item.participantId !== participantId));
      writeCollection(STORAGE_KEYS.registrations, readCollection(STORAGE_KEYS.registrations).filter((item) => item.participantId !== participantId));
      writeCollection(STORAGE_KEYS.attendance, readCollection(STORAGE_KEYS.attendance).filter((item) => item.participantId !== participantId));
      drawParticipants();
    }));
  }

  drawParticipants();
}

function renderRegistrationsPage() {
  const auth = getAuthState();
  if (!auth.isAuthenticated) {
    renderLogin();
    return;
  }

  let message = '';
  let messageType = '';

  function drawRegistrations() {
    const events = readCollection(STORAGE_KEYS.events);
    const participants = readCollection(STORAGE_KEYS.participants);
    const registrations = readCollection(STORAGE_KEYS.registrations);
    const eventById = new Map(events.map((event) => [event.eventId, event]));
    const participantById = new Map(participants.map((participant) => [participant.participantId, participant]));

    app.innerHTML = `
      <div class="app-shell">
        <header class="topbar">
          <div><p class="eyebrow">Event Management System</p><h1>Registrations</h1></div>
          <div class="user-area"><span>Signed in as <strong>${auth.username}</strong></span><button id="dashboard-button" class="button secondary" type="button">Dashboard</button><button id="events-button" class="button secondary" type="button">Events</button><button id="participants-button" class="button secondary" type="button">Participants</button><button id="attendance-button" class="button secondary" type="button">Attendance</button><button id="logout-button" class="button secondary" type="button">Log out</button></div>
        </header>
        <main class="content">
          <section class="panel registration-panel">
            <div class="panel-heading"><div><p class="eyebrow">Registration management</p><h2>Register a Participant</h2></div></div>
            <form id="registration-form" class="registration-form">
              <label class="filter-field">Event<select id="registration-event"><option value="">Select an event</option>${events.map((event) => `<option value="${event.eventId}">${event.eventName} (${registrations.filter((item) => item.eventId === event.eventId).length}/${event.capacity})</option>`).join('')}</select></label>
              <label class="filter-field">Participant<select id="registration-participant"><option value="">Select a participant</option>${participants.map((participant) => `<option value="${participant.participantId}">${participant.name} — ${participant.email}</option>`).join('')}</select></label>
              <button class="button primary" type="submit">Create registration</button>
              ${message ? `<p class="form-message ${messageType}" role="${messageType === 'error' ? 'alert' : 'status'}">${message}</p>` : ''}
            </form>
          </section>
          <section class="panel">
            <div class="panel-heading"><div><p class="eyebrow">Stored records</p><h2>Registration List</h2></div><span class="muted">${registrations.length} total</span></div>
            ${registrations.length ? `<div class="table-wrap"><table><thead><tr><th>Event</th><th>Participant</th><th>Registration Date</th><th>Status</th></tr></thead><tbody>${registrations.map((registration) => `<tr><td>${eventById.get(registration.eventId)?.eventName ?? 'Unknown event'}</td><td>${participantById.get(registration.participantId)?.name ?? 'Unknown participant'}</td><td>${formatDate(registration.registrationDate)}</td><td><span class="status-badge">${registration.status}</span></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state"><h3>No registrations yet</h3><p class="muted">Select an event and participant to create the first registration.</p></div>'}
          </section>
        </main>
      </div>
    `;

    document.querySelector('#dashboard-button').addEventListener('click', renderProtectedApp);
    document.querySelector('#events-button').addEventListener('click', renderEventsPage);
    document.querySelector('#participants-button').addEventListener('click', renderParticipantsPage);
    document.querySelector('#attendance-button').addEventListener('click', renderAttendancePage);
    document.querySelector('#logout-button').addEventListener('click', () => {
      setAuthState({ isAuthenticated: false, userId: null, username: null, role: null });
      renderLogin();
    });
    document.querySelector('#registration-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const eventId = document.querySelector('#registration-event').value;
      const participantId = document.querySelector('#registration-participant').value;
      const selectedEvent = events.find((item) => item.eventId === eventId);
      const selectedParticipant = participants.find((item) => item.participantId === participantId);
      const eventRegistrations = registrations.filter((item) => item.eventId === eventId && item.status !== 'Cancelled');

      if (!selectedEvent) {
        message = 'Please select an existing event.';
        messageType = 'error';
      } else if (!selectedParticipant) {
        message = 'Please select an existing participant.';
        messageType = 'error';
      } else if (registrations.some((item) => item.eventId === eventId && item.participantId === participantId && item.status !== 'Cancelled')) {
        message = 'This participant is already registered for the selected event.';
        messageType = 'error';
      } else if (eventRegistrations.length >= Number(selectedEvent.capacity)) {
        message = 'Event capacity has been reached.';
        messageType = 'error';
      } else {
        registrations.push({ registrationId: `registration_${String(registrations.length + 1).padStart(3, '0')}`, eventId, participantId, registrationDate: new Date().toISOString().slice(0, 10), status: 'Registered' });
        writeCollection(STORAGE_KEYS.registrations, registrations);
        message = 'Registration created successfully.';
        messageType = 'success';
      }
      drawRegistrations();
    });
  }

  drawRegistrations();
}

function renderAttendancePage() {
  const auth = getAuthState();
  if (!auth.isAuthenticated) {
    renderLogin();
    return;
  }

  let selectedEventId = '';
  let message = '';

  function drawAttendance() {
    const events = readCollection(STORAGE_KEYS.events);
    const participants = readCollection(STORAGE_KEYS.participants);
    const registrations = readCollection(STORAGE_KEYS.registrations);
    const attendance = readCollection(STORAGE_KEYS.attendance);
    const selectedEvent = events.find((event) => event.eventId === selectedEventId);
    const registeredIds = new Set(registrations.filter((item) => item.eventId === selectedEventId && item.status !== 'Cancelled').map((item) => item.participantId));
    const registeredParticipants = participants.filter((participant) => registeredIds.has(participant.participantId));
    const presentCount = registeredParticipants.filter((participant) => attendance.some((item) => item.eventId === selectedEventId && item.participantId === participant.participantId && item.status === 'Present')).length;

    app.innerHTML = `
      <div class="app-shell">
        <header class="topbar">
          <div><p class="eyebrow">Event Management System</p><h1>Attendance</h1></div>
          <div class="user-area"><span>Signed in as <strong>${auth.username}</strong></span><button id="dashboard-button" class="button secondary" type="button">Dashboard</button><button id="events-button" class="button secondary" type="button">Events</button><button id="participants-button" class="button secondary" type="button">Participants</button><button id="registrations-button" class="button secondary" type="button">Registrations</button><button id="logout-button" class="button secondary" type="button">Log out</button></div>
        </header>
        <main class="content">
          <section class="panel attendance-panel">
            <div class="panel-heading"><div><p class="eyebrow">Attendance tracking</p><h2>Mark Attendance</h2></div></div>
            <label class="filter-field attendance-event">Event<select id="attendance-event"><option value="">Select an event</option>${events.map((event) => `<option value="${event.eventId}" ${event.eventId === selectedEventId ? 'selected' : ''}>${event.eventName}</option>`).join('')}</select></label>
            ${selectedEvent ? `<div class="attendance-summary"><span>Total registered <strong>${registeredParticipants.length}</strong></span><span>Total present <strong>${presentCount}</strong></span><span>Total absent <strong>${registeredParticipants.length - presentCount}</strong></span><span>Attendance percentage <strong>${registeredParticipants.length ? Math.round((presentCount / registeredParticipants.length) * 100) : 0}%</strong></span></div>` : ''}
            ${message ? `<p class="form-message success" role="status">${message}</p>` : ''}
            ${selectedEvent && registeredParticipants.length ? `<div class="table-wrap"><table><thead><tr><th>Participant</th><th>Email</th><th>Attendance</th></tr></thead><tbody>${registeredParticipants.map((participant) => { const record = attendance.find((item) => item.eventId === selectedEventId && item.participantId === participant.participantId); const status = record?.status ?? 'Absent'; return `<tr><td><strong>${participant.name}</strong></td><td>${participant.email}</td><td><div class="attendance-actions"><button class="attendance-button ${status === 'Present' ? 'selected' : ''}" data-participant-id="${participant.participantId}" data-status="Present" type="button">Present</button><button class="attendance-button ${status === 'Absent' ? 'selected absent' : ''}" data-participant-id="${participant.participantId}" data-status="Absent" type="button">Absent</button></div></td></tr>`; }).join('')}</tbody></table></div>` : selectedEvent ? '<div class="empty-state"><h3>No registered participants</h3><p class="muted">Only participants registered for this event can appear here.</p></div>' : '<div class="empty-state"><h3>Select an event</h3><p class="muted">Choose an event to view its registered participants.</p></div>'}
          </section>
        </main>
      </div>
    `;

    document.querySelector('#dashboard-button').addEventListener('click', renderProtectedApp);
    document.querySelector('#events-button').addEventListener('click', renderEventsPage);
    document.querySelector('#participants-button').addEventListener('click', renderParticipantsPage);
    document.querySelector('#registrations-button').addEventListener('click', renderRegistrationsPage);
    document.querySelector('#logout-button').addEventListener('click', () => { setAuthState({ isAuthenticated: false, userId: null, username: null, role: null }); renderLogin(); });
    document.querySelector('#attendance-event').addEventListener('change', (event) => { selectedEventId = event.target.value; message = ''; drawAttendance(); });
    document.querySelectorAll('.attendance-button').forEach((button) => button.addEventListener('click', () => {
      const participantId = button.dataset.participantId;
      const status = button.dataset.status;
      const currentAttendance = readCollection(STORAGE_KEYS.attendance);
      const existingIndex = currentAttendance.findIndex((item) => item.eventId === selectedEventId && item.participantId === participantId);
      const record = { attendanceId: existingIndex >= 0 ? currentAttendance[existingIndex].attendanceId : `attendance_${String(currentAttendance.length + 1).padStart(3, '0')}`, eventId: selectedEventId, participantId, status };
      if (existingIndex >= 0) currentAttendance[existingIndex] = record; else currentAttendance.push(record);
      writeCollection(STORAGE_KEYS.attendance, currentAttendance);
      message = 'Attendance saved successfully.';
      drawAttendance();
    }));
  }

  drawAttendance();
}

function renderLogin(error = '') {
  app.innerHTML = `
    <main class="auth-shell">
      <section class="auth-card" aria-labelledby="login-title">
        <div class="brand-mark">EMS</div>
        <p class="eyebrow">Event Management System</p>
        <h1 id="login-title">Welcome back</h1>
        <p class="muted">Sign in to manage your events and participants.</p>
        <form id="login-form" novalidate>
          <label for="username">Username</label>
          <input id="username" name="username" type="text" autocomplete="username" required />
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required />
          <p class="form-message error" role="alert" ${error ? '' : 'hidden'}>${error}</p>
          <button class="button primary" type="submit">Log in</button>
        </form>
        <p class="demo-hint">Demo account: <strong>admin</strong> / <strong>admin123</strong></p>
      </section>
    </main>
  `;

  document.querySelector('#login-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const username = String(form.get('username')).trim();
    const password = String(form.get('password'));

    if (username === DEMO_USERNAME && password === DEMO_PASSWORD) {
      setAuthState({ isAuthenticated: true, userId: 'user_001', username, role: 'admin' });
      renderProtectedApp();
      return;
    }

    renderLogin('The username or password is incorrect.');
  });
}

function renderProtectedApp() {
  const auth = getAuthState();
  if (!auth.isAuthenticated) {
    renderLogin();
    return;
  }

  seedApplicationData();
  const data = dashboardData();
  const eventById = new Map(data.events.map((event) => [event.eventId, event]));
  const participantById = new Map(data.participants.map((participant) => [participant.participantId, participant]));

  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">Event Management System</p>
          <h1>Dashboard</h1>
        </div>
          <div class="user-area">
            <span>Signed in as <strong>${auth.username}</strong></span>
            <button id="events-button" class="button secondary" type="button">Events</button>
            <button id="participants-button" class="button secondary" type="button">Participants</button>
            <button id="registrations-button" class="button secondary" type="button">Registrations</button>
            <button id="attendance-button" class="button secondary" type="button">Attendance</button>
            <button id="logout-button" class="button secondary" type="button">Log out</button>
        </div>
      </header>
      <main class="content">
        <section class="stat-grid" aria-label="Dashboard statistics">
          <article class="stat-card"><span>Total Events</span><strong>${data.events.length}</strong></article>
          <article class="stat-card"><span>Upcoming Events</span><strong>${data.upcomingEvents.length}</strong></article>
          <article class="stat-card"><span>Total Participants</span><strong>${data.participants.length}</strong></article>
          <article class="stat-card"><span>Total Registrations</span><strong>${data.registrations.length}</strong></article>
          <article class="stat-card"><span>Attendance Rate</span><strong>${data.attendanceRate}%</strong></article>
        </section>
        <section class="dashboard-grid">
          <article class="panel">
            <div class="panel-heading"><div><p class="eyebrow">Schedule</p><h2>Upcoming Events</h2></div><button class="button secondary" id="add-event" type="button">Add event</button></div>
            ${data.upcomingEvents.length ? `<div class="item-list">${data.upcomingEvents.map((event) => `<div class="list-item"><div><strong>${event.eventName}</strong><span>${formatDate(event.date)} · ${event.location}</span></div><span class="status-badge">${event.status}</span></div>`).join('')}</div>` : '<p class="muted">No upcoming events yet.</p>'}
          </article>
          <article class="panel">
            <div class="panel-heading"><div><p class="eyebrow">Latest activity</p><h2>Recent Registrations</h2></div><button class="button secondary" id="add-registration" type="button">Register</button></div>
            ${data.recentRegistrations.length ? `<div class="item-list">${data.recentRegistrations.map((registration) => `<div class="list-item"><div><strong>${participantById.get(registration.participantId)?.name ?? 'Unknown participant'}</strong><span>${eventById.get(registration.eventId)?.eventName ?? 'Unknown event'}</span></div><span>${formatDate(registration.registrationDate)}</span></div>`).join('')}</div>` : '<p class="muted">No registrations yet.</p>'}
          </article>
        </section>
        <section class="panel quick-actions">
          <div><p class="eyebrow">Shortcuts</p><h2>Quick Actions</h2><p class="muted">Use these actions to update local application data and see the dashboard recalculate.</p></div>
          <div class="action-row"><button class="button primary" id="add-participant" type="button">Add participant</button><button class="button secondary" id="refresh-dashboard" type="button">Refresh statistics</button></div>
        </section>
      </main>
    </div>
  `;

  document.querySelector('#logout-button').addEventListener('click', () => {
    setAuthState({ isAuthenticated: false, userId: null, username: null, role: null });
    renderLogin();
  });
  document.querySelector('#events-button').addEventListener('click', renderEventsPage);
  document.querySelector('#participants-button').addEventListener('click', renderParticipantsPage);
  document.querySelector('#registrations-button').addEventListener('click', renderRegistrationsPage);
  document.querySelector('#attendance-button').addEventListener('click', renderAttendancePage);
  document.querySelector('#refresh-dashboard').addEventListener('click', renderProtectedApp);
  document.querySelector('#add-event').addEventListener('click', () => {
    const events = readCollection(STORAGE_KEYS.events);
    const nextNumber = events.length + 1;
    const date = new Date();
    date.setDate(date.getDate() + 30 + nextNumber);
    events.push({ eventId: `event_${String(nextNumber).padStart(3, '0')}`, eventName: `New Planning Session ${nextNumber}`, description: '', date: date.toISOString().slice(0, 10), time: '10:00', location: 'Main Hall', organizer: 'Admin', capacity: 20, status: 'Upcoming' });
    writeCollection(STORAGE_KEYS.events, events);
    renderProtectedApp();
  });
  document.querySelector('#add-participant').addEventListener('click', () => {
    const participants = readCollection(STORAGE_KEYS.participants);
    const nextNumber = participants.length + 1;
    participants.push({ participantId: `participant_${String(nextNumber).padStart(3, '0')}`, name: `New Participant ${nextNumber}`, email: `participant${nextNumber}@example.com`, phone: '', organisation: 'Demo Organisation' });
    writeCollection(STORAGE_KEYS.participants, participants);
    renderProtectedApp();
  });
  document.querySelector('#add-registration').addEventListener('click', () => {
    const events = readCollection(STORAGE_KEYS.events);
    const participants = readCollection(STORAGE_KEYS.participants);
    const registrations = readCollection(STORAGE_KEYS.registrations);
    const event = events[0];
    const participant = participants.find((item) => !registrations.some((registration) => registration.eventId === event?.eventId && registration.participantId === item.participantId));
    if (event && participant) {
      registrations.push({ registrationId: `registration_${String(registrations.length + 1).padStart(3, '0')}`, eventId: event.eventId, participantId: participant.participantId, registrationDate: new Date().toISOString().slice(0, 10), status: 'Registered' });
      writeCollection(STORAGE_KEYS.registrations, registrations);
      renderProtectedApp();
    }
  });
}

async function bootstrap() {
  await syncFromGoogleSheets();
  seedApplicationData();
  if (getAuthState().isAuthenticated) renderProtectedApp();
  else renderLogin();
}

bootstrap();
