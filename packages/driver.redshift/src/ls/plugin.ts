import { ILanguageServerPlugin } from '@sqltools/types';
import RedshiftDriver from './driver'; // Use src/ls/driver.ts
import { DRIVER_ALIASES } from '../constants';

const RedshiftDriverPlugin: ILanguageServerPlugin = {
  register(server) {
    DRIVER_ALIASES.forEach(({ value }) => {
      server.getContext().drivers.set(value, RedshiftDriver);
    });
  }
};

export default RedshiftDriverPlugin;
