import { ILanguageServerPlugin, IConnectionDriverConstructor } from '@sqltools/types';
import RedshiftDriver from './driver';
import { DRIVER_ALIASES } from '../constants';

const RedshiftDriverPlugin: ILanguageServerPlugin = {
  register(server) {
    DRIVER_ALIASES.forEach(({ value }) => {
      server.getContext().drivers.set(value, RedshiftDriver as unknown as IConnectionDriverConstructor);
    });
  }
};

export default RedshiftDriverPlugin;
