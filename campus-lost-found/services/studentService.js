(function () {
  window.studentService = {
    getStudents() {
      return window.appStore.getState().students || [];
    },
    getStudentById(id) {
      return this.getStudents().find((student) => student.id === id) || null;
    },
    async registerStudent(formData) {
      const student = await window.apiClient.request('/students', {
        method: 'POST',
        body: JSON.stringify(formData)
      });
      window.appStore.upsert('students', student);
      return student;
    },
    async loginStudent(email, password) {
      const student = await window.apiClient.request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      const state = window.appStore.getState();
      state.currentUserId = student.id;
      state.students = student.role === 'admin'
        ? state.students
        : [student];
      window.appStore.saveState(state);
      return student;
    },
    async updateStudent(id, updates) {
      const student = await window.apiClient.request(`/students/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(updates)
      });
      window.appStore.upsert('students', student);
      return student;
    },
    async deleteStudent(id) {
      await window.apiClient.request(`/students/${encodeURIComponent(id)}`, { method: 'DELETE' });
      window.appStore.remove('students', id);
      return true;
    }
  };
})();
