const { ipcRenderer } = require('electron');

(() => {
    const OriginalNotification = window.Notification;
    const sendWebNotification = (title, options = {}) => {
        const safeTitle = typeof title === 'string' && title.trim() ? title : 'Notification';
        const safeOptions = (options && typeof options === 'object') ? options : {};

        ipcRenderer.send('web-notification', {
            title: safeTitle,
            body: typeof safeOptions.body === 'string' ? safeOptions.body : '',
            silent: Boolean(safeOptions.silent),
            urgency: typeof safeOptions.urgency === 'string' ? safeOptions.urgency : undefined
        });
    };

    class ElectronNotification extends EventTarget {
        constructor(title, options = {}) {
            super();
            sendWebNotification(title, options);
        }

        get onclick() { return this._onclick ?? null; }
        set onclick(fn) {
            if (this._onclick) this.removeEventListener('click', this._onclick);
            this._onclick = typeof fn === 'function' ? fn : null;
            if (this._onclick) this.addEventListener('click', this._onclick);
        }

        get onclose() { return this._onclose ?? null; }
        set onclose(fn) {
            if (this._onclose) this.removeEventListener('close', this._onclose);
            this._onclose = typeof fn === 'function' ? fn : null;
            if (this._onclose) this.addEventListener('close', this._onclose);
        }

        get onshow() { return this._onshow ?? null; }
        set onshow(fn) {
            if (this._onshow) this.removeEventListener('show', this._onshow);
            this._onshow = typeof fn === 'function' ? fn : null;
            if (this._onshow) this.addEventListener('show', this._onshow);
        }

        get onerror() { return this._onerror ?? null; }
        set onerror(fn) {
            if (this._onerror) this.removeEventListener('error', this._onerror);
            this._onerror = typeof fn === 'function' ? fn : null;
            if (this._onerror) this.addEventListener('error', this._onerror);
        }

        close() {}

        static requestPermission(callback) {
            const permission = 'granted';
            if (typeof callback === 'function') {
                callback(permission);
            }
            return Promise.resolve(permission);
        }
    }

    ElectronNotification.permission = 'granted';
    ElectronNotification.maxActions = OriginalNotification?.maxActions || 0;

    window.Notification = ElectronNotification;

    if ('ServiceWorkerRegistration' in window && ServiceWorkerRegistration.prototype.showNotification) {
        ServiceWorkerRegistration.prototype.showNotification = function showNotification(title, options = {}) {
            sendWebNotification(title, options);
            return Promise.resolve();
        };
    }
})();
