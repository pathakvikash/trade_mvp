import React from 'react';

// Profile picture: data-URL image, "emoji:<emoji>", or initials when neither is set.
const SIZES = { xs: 'h-6 w-6 text-[10px]', sm: 'h-7 w-7 text-xs', md: 'h-10 w-10 text-base', lg: 'h-16 w-16 text-2xl' };

export const initialsOf = (name) => {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return words.length ? words.map((w) => Array.from(w)[0].toUpperCase()).join('') : '?';
};

const Avatar = ({ avatar, name, size = 'sm', className = '' }) => {
  const box = `grid shrink-0 place-items-center overflow-hidden rounded-full border border-slate-700 bg-slate-900 font-semibold text-slate-200 ${SIZES[size] || SIZES.sm} ${className}`;
  if (typeof avatar === 'string' && avatar.startsWith('data:image/')) {
    return <img src={avatar} alt="" aria-hidden="true" className={`${box} object-cover`} />;
  }
  if (typeof avatar === 'string' && avatar.startsWith('emoji:')) {
    return <span aria-hidden="true" className={`${box} leading-none`}>{avatar.slice(6)}</span>;
  }
  return <span aria-hidden="true" className={`${box} uppercase`}>{initialsOf(name)}</span>;
};

export default Avatar;
