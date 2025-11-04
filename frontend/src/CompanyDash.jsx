// App.jsx
import React from 'react';
import './CompDash.css';
import CompanyView from './components/company/CompanyView';

function CompanyDash() {
  return (
    <div className='app'>
      <CompanyView />
    </div>
  );
}

export default CompanyDash;
