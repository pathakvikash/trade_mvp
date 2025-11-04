// CompanyView.jsx
import React from 'react';
import { observer } from 'mobx-react-lite';
import { companyViewModel } from '../CompanyViewModel';
import './CompanyView.css';

const CompanyView = observer(() => {
    const handleDepartmentClick = (department) => {
        companyViewModel.setSelectedDepartment(department);
    };

    return (
        <div className="company-container">
            <header className="company-header">
                <h1>{companyViewModel.company.name}</h1>
                <p className="tagline">{companyViewModel.company.description}</p>
            </header>

            <section className="company-overview">
                <div className="info-grid">
                    <div className="info-card">
                        <h3>Founded</h3>
                        <p>{companyViewModel.company.yearFounded}</p>
                    </div>
                    <div className="info-card">
                        <h3>Total Employees</h3>
                        <p>{companyViewModel.getTotalEmployees()}</p>
                    </div>
                    <div className="info-card">
                        <h3>Total Projects</h3>
                        <p>{companyViewModel.getTotalProjects()}</p>
                    </div>
                    <div className="info-card">
                        <h3>Location</h3>
                        <p>{companyViewModel.company.headquarters}</p>
                    </div>
                </div>
            </section>

            <section className="industries-section">
                <h2>Industries</h2>
                <div className="industry-tags">
                    {companyViewModel.company.industries.map((industry, index) => (
                        <span key={index} className="industry-tag">
                            {industry}
                        </span>
                    ))}
                </div>
            </section>

            <section className="departments-section">
                <h2>Departments</h2>
                <div className="departments-grid">
                    {companyViewModel.company.departments.map((dept, index) => (
                        <div
                            key={index}
                            className={`department-card ${companyViewModel.selectedDepartment === dept ? 'selected' : ''}`}
                            onClick={() => handleDepartmentClick(dept)}
                        >
                            <h3>{dept.name}</h3>
                            <p>Employees: {dept.headCount}</p>
                            <p>Active Projects: {dept.projects}</p>
                        </div>
                    ))}
                </div>
            </section>

            <section className="contact-section">
                <h2>Contact Information</h2>
                <div className="contact-details">
                    <div className="contact-item">
                        <i className="icon email-icon"></i>
                        <p>{companyViewModel.company.contact.email}</p>
                    </div>
                    <div className="contact-item">
                        <i className="icon phone-icon"></i>
                        <p>{companyViewModel.company.contact.phone}</p>
                    </div>
                    <div className="contact-item">
                        <i className="icon address-icon"></i>
                        <p>{companyViewModel.company.contact.address}</p>
                    </div>
                </div>
            </section>

            {companyViewModel.selectedDepartment && (
                <div className="modal-overlay" onClick={() => companyViewModel.clearSelectedDepartment()}>
                    <div className="department-modal" onClick={e => e.stopPropagation()}>
                        <h2>{companyViewModel.selectedDepartment.name} Department</h2>
                        <div className="department-stats">
                            <div className="stat-item">
                                <h4>Team Size</h4>
                                <p>{companyViewModel.selectedDepartment.headCount} employees</p>
                            </div>
                            <div className="stat-item">
                                <h4>Active Projects</h4>
                                <p>{companyViewModel.selectedDepartment.projects} projects</p>
                            </div>
                        </div>
                        <button className="close-button" onClick={() => companyViewModel.clearSelectedDepartment()}>
                            Close
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
});

export default CompanyView;