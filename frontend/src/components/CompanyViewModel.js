// CompanyViewModel.js
import { makeAutoObservable } from 'mobx';

class CompanyViewModel {
  company = {
    name: 'Tech Innovations Inc.',
    description: 'Leading technology solutions provider',
    yearFounded: 2010,
    employees: 500,
    headquarters: 'San Francisco, CA',
    industries: ['Technology', 'Software', 'Consulting'],
    contact: {
      email: 'info@techinnovations.com',
      phone: '(555) 123-4567',
      address: '123 Innovation Drive',
    },
    departments: [
      {
        name: 'Engineering',
        headCount: 200,
        projects: 15,
      },
      {
        name: 'Sales',
        headCount: 100,
        projects: 8,
      },
      {
        name: 'Marketing',
        headCount: 75,
        projects: 6,
      },
      {
        name: 'Research & Development',
        headCount: 125,
        projects: 10,
      },
    ],
  };

  selectedDepartment = null;

  constructor() {
    makeAutoObservable(this);
  }

  setSelectedDepartment(department) {
    this.selectedDepartment = department;
  }

  getTotalProjects() {
    return this.company.departments.reduce(
      (total, dept) => total + dept.projects,
      0
    );
  }

  getTotalEmployees() {
    return this.company.employees;
  }

  clearSelectedDepartment() {
    this.selectedDepartment = null;
  }
}

export const companyViewModel = new CompanyViewModel();
