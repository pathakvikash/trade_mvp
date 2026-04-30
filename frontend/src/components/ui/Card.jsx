import React from 'react';

const Card = ({ children, className = '' }) => {
  return (
    <div
      className={`rounded-[1.1rem] border border-slate-800 bg-slate-950/95 p-5 shadow-soft backdrop-blur-sm ${className}`}
    >
      {children}
    </div>
  );
};

export default Card;
