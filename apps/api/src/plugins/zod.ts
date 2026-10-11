import type { FastifyPluginCallback } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

const zodPlugin: FastifyPluginCallback = (server, _pluginOptions, completePluginRegistration) => {
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);
  completePluginRegistration();
};

export default fastifyPlugin(zodPlugin, {
  name: 'api-zod',
  fastify: '5.x',
});
