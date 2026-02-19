#!/usr/bin/env bash
docker build -t engageai:latest ../engageai-backend
sudo systemctl stop engageai
sudo cp engageai.service /usr/lib/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start engageai
sudo systemctl status engageai