const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codexUsagePet', {
  getUsage: () => ipcRenderer.invoke('usage:get'),
  close: () => ipcRenderer.invoke('window:close'),
  toggleTop: () => ipcRenderer.invoke('window:toggle-top'),
  reload: () => ipcRenderer.invoke('window:reload'),
  moveBy: (delta) => ipcRenderer.invoke('window:move-by', delta),
  resizeBy: (delta) => ipcRenderer.invoke('window:resize-by', delta),
  resizeTo: (size) => ipcRenderer.invoke('window:resize-to', size),
  onHoverState: (callback) => {
    const listener = (_event, inside) => callback(Boolean(inside));
    ipcRenderer.on('window:hover-state', listener);
    return () => ipcRenderer.removeListener('window:hover-state', listener);
  }
});
