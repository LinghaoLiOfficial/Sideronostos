// Test environment only: jsdom has no native dialog presentation implementation.
HTMLDialogElement.prototype.show = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
