export const ZONES = [
  { id: 'tl', avenger: 'Iron Man',        color: '#e23636', accent: '#f5c542', position: 'Top-Left' },
  { id: 'tr', avenger: 'Captain America', color: '#3a7bd5', accent: '#e23636', position: 'Top-Right' },
  { id: 'bl', avenger: 'Hulk',            color: '#4caf50', accent: '#7b1fa2', position: 'Bottom-Left' },
  { id: 'br', avenger: 'Thor',            color: '#b0bec5', accent: '#29b6f6', position: 'Bottom-Right' },
];
export const ZONE_IDS = ZONES.map(z => z.id);
export const REJECT_LABEL = 'ultron';
export const zoneById = id => ZONES.find(z => z.id === id);
