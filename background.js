// Toolbar-icon click: if we're on the My Decks page, start the download there;
// otherwise open My Decks, since that's the only page the downloader runs on.
chrome.action.onClicked.addListener((tab) => {
  const onMyDecks =
    tab.url && /:\/\/([a-z0-9-]+\.)?marvelcdb\.com\/decks(\/|\?|#|$)/.test(tab.url);
  if (onMyDecks) {
    chrome.tabs.sendMessage(tab.id, 'mcb-start-backup').catch(() => {});
  } else {
    chrome.tabs.create({ url: 'https://marvelcdb.com/decks' });
  }
});
