import { contextBridge, ipcRenderer } from 'electron';
import { channels, type DesktopApi, type SaveRecord } from '../contracts/desktop';

const api: DesktopApi = Object.freeze({
  status: () => ipcRenderer.invoke(channels.status),
  saveRecord: (input: SaveRecord) => ipcRenderer.invoke(channels.saveRecord, input),
  createSnapshot: () => ipcRenderer.invoke(channels.createSnapshot),
  verifyRestore: () => ipcRenderer.invoke(channels.verifyRestore),
  checkKeyStorage: () => ipcRenderer.invoke(channels.checkKeyStorage),
  chooseFolder: () => ipcRenderer.invoke(channels.chooseFolder),
});
contextBridge.exposeInMainWorld('mediPharm', api);
