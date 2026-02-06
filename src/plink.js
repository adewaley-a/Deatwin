import React from 'react';

const Plink = ({ href, children, target = "_self", ...props }) => {
  return (
    <a href={href} target={target} rel={target === "_blank" ? "noopener noreferrer" : ""} {...props}>
      {children}
    </a>
  );
};

export default Plink;