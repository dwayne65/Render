(function () {
  window.notificationService = {
    getNotifications() {
      return window.appStore.getState().notifications || [];
    },
    createNotification(data) {
      const state = window.appStore.getState();
      const notification = {
        id: `note-${Date.now()}`,
        read: false,
        createdAt: new Date().toISOString(),
        ...data
      };
      state.notifications.unshift(notification);
      window.appStore.saveState(state);
      return notification;
    },
    markAsRead(id) {
      const state = window.appStore.getState();
      state.notifications = state.notifications.map((notification) =>
        notification.id === id ? { ...notification, read: true } : notification
      );
      window.appStore.saveState(state);
      return true;
    }
  };
})();
