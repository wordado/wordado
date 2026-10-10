-- Nothing from Google sign-in that the app does not use (#163): the name and the picture Better Auth copied
-- from the Google profile, and the tokens it keeps for calling Google, which the app never does. From now on
-- the hooks in src/auth.ts keep them from being written; this blanks what earlier sign-ins left behind.
update "user" set "name" = '', "image" = null where "name" <> '' or "image" is not null;
update "account"
  set "accessToken" = null, "refreshToken" = null, "idToken" = null,
      "accessTokenExpiresAt" = null, "refreshTokenExpiresAt" = null, "scope" = null
  where "providerId" <> 'credential';
