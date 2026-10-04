
(function () {
'use strict';

if (!window.paper || !window.opentype || !window.FONT_DATA) {
  document.body.innerHTML = '<div style="padding:32px;font:16px system-ui">FriendShaped could not load its drawing libraries. Check your connection and reload the page.</div>';
  return;
}
paper.setup(new paper.Size(16, 16));

