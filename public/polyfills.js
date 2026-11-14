// Older browsers (iPhones / iPads before iOS 15.4, older school Chromebooks) lack a few newer features the game uses:
// add simple versions of them before anything else runs.
(function () {
  var w = window;
  // structuredClone (the game only clones plain data)
  if (typeof w.structuredClone !== "function") w.structuredClone = function (v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };
  // AbortSignal.timeout
  if (typeof w.AbortSignal !== "undefined" && typeof AbortSignal.timeout !== "function") AbortSignal.timeout = function (ms) { var c = new AbortController(); setTimeout(function () { try { c.abort(); } catch (e) {} }, ms); return c.signal; };
  // <dialog>: show / showModal / close
  try {
    var d = document.createElement("dialog");
    if (typeof d.showModal !== "function") {
      var P = (w.HTMLDialogElement || w.HTMLUnknownElement || w.HTMLElement).prototype;
      var css = document.createElement("style");
      css.textContent = "dialog{display:none;position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:9500;margin:0}dialog[open]{display:block}";
      (document.head || document.documentElement).appendChild(css);
      P.show = function () { this.setAttribute("open", ""); };
      P.showModal = function () { this.setAttribute("open", ""); };
      P.close = function (r) { if (!this.hasAttribute("open")) return; this.removeAttribute("open"); if (r !== undefined) this.returnValue = r; try { this.dispatchEvent(new Event("close")); } catch (e) {} };
      try { Object.defineProperty(P, "open", { configurable: true, get: function () { return this.hasAttribute("open"); }, set: function (v) { if (v) this.setAttribute("open", ""); else this.removeAttribute("open"); } }); } catch (e) {}
    }
  } catch (e) {}
  // small newer helpers
  if (!Array.prototype.at) Object.defineProperty(Array.prototype, "at", { configurable: true, writable: true, value: function (i) { i = Math.trunc(i) || 0; if (i < 0) i += this.length; return this[i]; } });
  if (!String.prototype.at) Object.defineProperty(String.prototype, "at", { configurable: true, writable: true, value: function (i) { i = Math.trunc(i) || 0; if (i < 0) i += this.length; return this[i]; } });
  if (!Object.hasOwn) Object.hasOwn = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  if (!String.prototype.replaceAll) String.prototype.replaceAll = function (a, b) { return a instanceof RegExp ? this.replace(a, b) : this.split(a).join(b); };
  if (w.Element && !Element.prototype.replaceChildren) Element.prototype.replaceChildren = function () { while (this.firstChild) this.removeChild(this.firstChild); for (var i = 0; i < arguments.length; i++) this.append(arguments[i]); };
})();
