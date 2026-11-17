(function () {
  window.foundItemService = {
    getFoundItems() {
      return window.appStore.getState().foundItems || [];
    },
    getFoundItemById(id) {
      return this.getFoundItems().find((item) => item.id === id) || null;
    },
    async createFoundItem(data) {
      const item = await window.apiClient.request('/found-items', {
        method: 'POST',
        body: JSON.stringify(data)
      });
      window.appStore.upsert('foundItems', item);
      return item;
    },
    async updateFoundItem(id, updates) {
      const item = await window.apiClient.request(`/found-items/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(updates)
      });
      window.appStore.upsert('foundItems', item);
      return item;
    },
    async deleteFoundItem(id) {
      await window.apiClient.request(`/found-items/${encodeURIComponent(id)}`, { method: 'DELETE' });
      window.appStore.remove('foundItems', id);
      return true;
    }
  };
})();
