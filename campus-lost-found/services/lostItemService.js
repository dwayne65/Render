(function () {
  window.lostItemService = {
    getLostItems() {
      return window.appStore.getState().lostItems || [];
    },
    getLostItemById(id) {
      return this.getLostItems().find((item) => item.id === id) || null;
    },
    async createLostItem(data) {
      const item = await window.apiClient.request('/lost-items', {
        method: 'POST',
        body: JSON.stringify(data)
      });
      window.appStore.upsert('lostItems', item);
      return item;
    },
    async updateLostItem(id, updates) {
      const item = await window.apiClient.request(`/lost-items/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(updates)
      });
      window.appStore.upsert('lostItems', item);
      return item;
    },
    async deleteLostItem(id) {
      await window.apiClient.request(`/lost-items/${encodeURIComponent(id)}`, { method: 'DELETE' });
      window.appStore.remove('lostItems', id);
      return true;
    }
  };
})();
