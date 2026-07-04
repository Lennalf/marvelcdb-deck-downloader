// Toolbar-icon click: start the backup on a MarvelCDB tab, or open the site.
chrome.action.onClicked.addListener((tab) => {
  if (tab.url && /:\/\/([a-z0-9-]+\.)?marvelcdb\.com\//.test(tab.url)) {
    chrome.tabs.sendMessage(tab.id, 'mcb-start-backup').catch(() => {});
  } else {
    chrome.tabs.create({ url: 'https://marvelcdb.com/decks' });
  }
});
