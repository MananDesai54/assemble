export const ZONES = [
  { id: 'tl', label: 'Top left' },
  { id: 'tr', label: 'Top right' },
  { id: 'bl', label: 'Bottom left' },
  { id: 'br', label: 'Bottom right' },
];
export const ZONE_IDS = ZONES.map(z => z.id);
// Internal reject-class label. Kept as-is so existing calibration configs stay valid.
export const REJECT_LABEL = 'ultron';
export const zoneById = id => ZONES.find(z => z.id === id);
