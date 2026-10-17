
(function () {
'use strict';

if (!window.paper || !window.opentype || !window.FONT_DATA) {
  document.body.innerHTML = '<div style="padding:32px;font:16px system-ui">FriendShaped could not start its drawing libraries. Try reloading the page, or use a different browser.</div>';
  return;
}
paper.setup(new paper.Size(16, 16));

