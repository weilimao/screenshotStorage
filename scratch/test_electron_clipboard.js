const { app, clipboard, nativeImage } = require('electron');
const path = require('path');

app.whenReady().then(() => {
  const filePath = 'd:\\testCode\\screenshotStorage\\assets\\tray.png';
  const img = nativeImage.createFromPath(filePath);
  
  clipboard.write({
    image: img,
    ...({
      'file-paths': [filePath]
    })
  });
  
  console.log("Successfully wrote clipboard using Electron.");
  console.log("Formats after write:", clipboard.availableFormats());
  
  app.quit();
});
