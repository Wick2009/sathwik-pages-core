// Who is signed in, for Live mode. Uses Spring's /api/person/get, whose
// roles[] carries ROLE_TEACHER / ROLE_ADMIN (same check as _includes/nav/homejava.html).
// Note: this only gates the UI. The calendar and group-chat endpoints don't
// check roles on the server yet.

const TEACHER_ROLES = new Set(['ROLE_TEACHER', 'ROLE_ADMIN']);

// → { name, isTeacher } or null when signed out / backend unreachable
export async function fetchLiveIdentity({ javaURI, fetchOptions }) {
  try {
    const res = await fetch(`${javaURI}/api/person/get`, fetchOptions);
    if (!res.ok) return null;
    const person = await res.json();
    const name = person?.name || person?.uid;
    if (!name) return null;
    return { name, isTeacher: (person.roles || []).some((role) => TEACHER_ROLES.has(role?.name)) };
  } catch (err) {
    console.warn('Announcement calendar demo: identity lookup failed', err);
    return null;
  }
}
