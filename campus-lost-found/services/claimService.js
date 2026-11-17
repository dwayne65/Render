(function () {
  window.claimService = {
    getClaims() {
      return window.appStore.getState().claims || [];
    },
    getClaimById(id) {
      return this.getClaims().find((claim) => claim.id === id) || null;
    },
    async createClaim(data) {
      const claim = await window.apiClient.request('/claims', {
        method: 'POST',
        body: JSON.stringify(data)
      });
      window.appStore.upsert('claims', claim);
      return claim;
    },
    async updateClaimStatus(id, updates) {
      const claim = await window.apiClient.request(`/claims/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(updates)
      });
      window.appStore.upsert('claims', claim);
      return claim;
    }
  };
})();
