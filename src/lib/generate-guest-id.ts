"use client";

export function generateGuestId() {
  const existingId = localStorage.getItem('guestId');
  if (!existingId) {
    const array = new Uint32Array(8);
    window.crypto.getRandomValues(array);
    const newId = Array.from(array, dec => ('0' + dec.toString(16)).substr(-2)).join('');
    localStorage.setItem('guestId', newId);
    return newId;
  }
  return existingId;
}
