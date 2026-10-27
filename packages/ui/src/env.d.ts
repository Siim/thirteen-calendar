/** CSS Modules: class-name maps. */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}

/** Plain stylesheets imported for their side effects. */
declare module '*.css';
