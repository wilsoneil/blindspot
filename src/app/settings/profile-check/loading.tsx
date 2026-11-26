// The profile check builds the whole profile fresh, which takes a few seconds: show the
// spinner straight away. (The app-wide one doesn't show when coming from /settings, since
// Next.js only shows the nearest loading screen below the part of the page that stays.)
export { default } from "../../loading";
