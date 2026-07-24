import { Tray, Menu, nativeImage } from 'electron';

export function createTray({ getArmed, setArmed, openSettings, quit }) {
  const tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('🛡');
  const rebuild = () => {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Assemble mode', type: 'checkbox', checked: getArmed(),
        click: item => setArmed(item.checked) },
      { type: 'separator' },
      { label: 'Open Settings', click: openSettings },
      { type: 'separator' },
      { label: 'Quit', click: quit },
    ]));
    tray.setToolTip(getArmed() ? 'ASSEMBLE — armed' : 'ASSEMBLE — disarmed');
  };
  rebuild();
  return { tray, rebuild };
}
