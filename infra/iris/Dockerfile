# InterSystems IRIS for Health (Community) – FHIR R4 server + SQL/vector + globals for Onkomost.
# Based on intersystems-community/FHIR-AI-Hackathon-Kit (docker-iris-fhir).
FROM intersystems/irishealth-community:latest-cd

COPY --chown=irisowner:irisowner merge.cpf /tmp/merge.cpf

RUN iris start IRIS && \
    iris merge IRIS /tmp/merge.cpf && \
    iris stop IRIS quietly
