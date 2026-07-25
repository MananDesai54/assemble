import { Tray, Menu, nativeImage } from 'electron';

export function createTray({ getArmed, setArmed, openSettings, quit }) {
  const tray = new Tray(nativeImage.createEmpty());
  const rebuild = () => {
    tray.setTitle(getArmed() ? '◉' : '◌');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Listening', type: 'checkbox', checked: getArmed(),
        click: item => setArmed(item.checked) },
      { type: 'separator' },
      { label: 'Open assemble', click: openSettings },
      { type: 'separator' },
      { label: 'Quit', click: quit },
    ]));
    tray.setToolTip(getArmed() ? 'assemble — listening' : 'assemble — paused');
  };
  rebuild();
  return { tray, rebuild };
}
